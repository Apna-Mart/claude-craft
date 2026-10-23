# Haskell anti-patterns

Read this whole file before writing or reviewing Haskell code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Haskell-specific traps.

## Contents

1. Partial functions: `head`, `tail`, `fromJust`, `!!`, `maximum`
2. Incomplete pattern matches
3. Record fields that exist on only some constructors
4. `foldl` and lazy tuple accumulators
5. Lazy `modifyIORef` and lazy `Data.Map` accumulators
6. Lazy I/O: `hGetContents` with `withFile`, `readFile` then `writeFile`
7. `error` and `undefined` for recoverable failures
8. `throw` from pure code
9. Catching `SomeException`
10. `unsafePerformIO` for global mutable state
11. `read` on untrusted input and `Show` as a wire format
12. `String` for bulk text
13. `nub` on large lists
14. Orphan instances
15. Top-level bindings without type signatures
16. Hand-prefixed record field names
17. `length xs == 0` instead of `null xs`

## 1. Partial functions: `head`, `tail`, `fromJust`, `!!`, `maximum`

**Avoid:** Functions that crash on some inputs: `head`, `tail`, `init`, `last`, `fromJust`, `(!!)`, `maximum`/`minimum` on a possibly empty list.
**Why:** The type promises a value for every input, but an empty list or `Nothing` throws at runtime with a message that rarely points to the caller.
**Instead:** Pattern match, return `Maybe`/`Either`, use `Data.List.NonEmpty` when emptiness is impossible, or the total helpers `listToMaybe`, `Data.List.(!?)` and `unsnoc`.

```haskell
-- Bad
firstWord :: String -> String
firstWord s = head (words s)

lookupPort :: [(String, Int)] -> Int
lookupPort env = fromJust (lookup "PORT" env)
```

```haskell
-- Good
firstWord :: String -> Maybe String
firstWord s = listToMaybe (words s)

lookupPort :: [(String, Int)] -> Either String Int
lookupPort env = maybe (Left "PORT not set") Right (lookup "PORT" env)
```

**Caught by:** GHC `-Wx-partial` (on by default; covers `head` and `tail` only)
**Since:** GHC 9.8 / base 4.19 (`x-partial` warning, `Data.List.(!?)`, `unsnoc`)
**Source:** https://hackage.haskell.org/package/base/changelog

## 2. Incomplete pattern matches

**Avoid:** `case` expressions, function equations, lambdas or `let` pattern bindings that do not cover every constructor.
**Why:** The missing case compiles and crashes with "Non-exhaustive patterns" when it is hit, often after someone adds a constructor.
**Instead:** Cover every constructor explicitly (avoid a catch-all `_` on types that grow), and build with `-Wall` and these warnings as errors.

```haskell
-- Bad
data Status = Active | Suspended | Closed

label :: Status -> String
label Active    = "active"
label Suspended = "suspended"
```

```haskell
-- Good
data Status = Active | Suspended | Closed

label :: Status -> String
label Active    = "active"
label Suspended = "suspended"
label Closed    = "closed"
```

**Caught by:** GHC `-Wincomplete-patterns` (in `-W` and `-Wall`), `-Wincomplete-uni-patterns` (lambdas and pattern bindings, in `-Wall`)
**Source:** https://downloads.haskell.org/ghc/latest/docs/users_guide/using-warnings.html

## 3. Record fields that exist on only some constructors

**Avoid:** Record syntax on a sum type where a field name belongs to only some constructors.
**Why:** GHC generates a selector for every field, and applying it to the wrong constructor crashes at runtime ("No match in record selector").
**Instead:** Give each constructor its own record type and wrap it, then pattern match on the outer constructor.

```haskell
-- Bad
data Payment
  = Card { cardNumber :: Text, expiry :: Text }
  | Cash { amount :: Int }

describe :: Payment -> Text
describe p = cardNumber p
```

```haskell
-- Good
data CardDetails = CardDetails { cardNumber :: Text, expiry :: Text }

data Payment = Card CardDetails | Cash Int

describe :: Payment -> Text
describe (Card details) = cardNumber details
describe (Cash _)       = "cash"
```

**Caught by:** GHC `-Wpartial-fields` (not in `-Wall`); `-Wincomplete-record-selectors` (GHC 9.10+, in `-Wall`)
**Source:** https://downloads.haskell.org/ghc/latest/docs/users_guide/using-warnings.html

## 4. `foldl` and lazy tuple accumulators

**Avoid:** `foldl` for strict reductions, and `foldl'` over a tuple accumulator whose fields are left lazy.
**Why:** `foldl` builds a chain of thunks as long as the list before evaluating any of it, which leaks memory or overflows the stack; `foldl'` forces only the outer tuple, so its fields still pile up thunks.
**Instead:** Use `foldl'` (or `sum`, `length` and friends) and make accumulator fields strict with bang patterns or a strict data type.

```haskell
-- Bad
mean :: [Double] -> Double
mean xs = s / fromIntegral n
  where
    (s, n) = foldl (\(acc, len) x -> (acc + x, len + 1)) (0, 0 :: Int) xs
```

```haskell
-- Good
{-# LANGUAGE BangPatterns #-}

mean :: [Double] -> Double
mean xs = s / fromIntegral n
  where
    (s, n) = foldl' step (0, 0 :: Int) xs
    step (!acc, !len) x = (acc + x, len + 1)
```

**Since:** base 4.20 / GHC 9.10 (`foldl'` exported from `Prelude`; import it from `Data.List` on older versions)
**Source:** https://wiki.haskell.org/Foldr_Foldl_Foldl%27

## 5. Lazy `modifyIORef` and lazy `Data.Map` accumulators

**Avoid:** `modifyIORef`, `Data.Map` (lazy) or a lazy `State` for counters and running totals that are updated often and read rarely.
**Why:** Each update stores an unevaluated thunk instead of a number, so memory grows with the number of updates and the eventual read can overflow the stack.
**Instead:** Use `modifyIORef'` (or `atomicModifyIORef'` across threads) and `Data.Map.Strict`.

```haskell
-- Bad
import qualified Data.Map as Map

recordHit :: IORef (Map.Map Text Int) -> Text -> IO ()
recordHit ref path = modifyIORef ref (Map.insertWith (+) path 1)
```

```haskell
-- Good
import qualified Data.Map.Strict as Map

recordHit :: IORef (Map.Map Text Int) -> Text -> IO ()
recordHit ref path = modifyIORef' ref (Map.insertWith (+) path 1)
```

**Source:** https://hackage.haskell.org/package/base/docs/Data-IORef.html

## 6. Lazy I/O: `hGetContents` with `withFile`, `readFile` then `writeFile`

**Avoid:** Reading with lazy `hGetContents` inside `withFile` and using the result after the block, or writing to a file whose lazy `readFile` contents are not fully consumed.
**Why:** The handle closes before the lazy string is read, so you get an error or truncated data; `readFile` keeps a semi-closed handle until the whole content is consumed, so writing the same file fails with a locked-file error.
**Instead:** Read strictly: `Data.Text.IO.readFile`, `Data.ByteString.readFile`, or `readFile'`; use a streaming library for large inputs.

```haskell
-- Bad
main :: IO ()
main = do
  contents <- withFile "config.txt" ReadMode hGetContents
  putStrLn contents
```

```haskell
-- Good
import qualified Data.Text.IO as TIO

main :: IO ()
main = do
  contents <- TIO.readFile "config.txt"
  TIO.putStrLn contents
```

**Since:** base 4.15 / GHC 9.0 (`readFile'`, `hGetContents'` in `System.IO`)
**Source:** https://hackage.haskell.org/package/base/docs/System-IO.html

## 7. `error` and `undefined` for recoverable failures

**Avoid:** Calling `error` for invalid input or missing data, and leaving `undefined` placeholders in shipped code.
**Why:** The failure is invisible in the type, so callers cannot handle it, and it fires whenever the value happens to be forced, often far from the cause.
**Instead:** Return `Maybe` or `Either` with a domain error type; keep `error` for states that are truly impossible.

```haskell
-- Bad
parseAge :: Text -> Int
parseAge t = case readMaybe (unpack t) of
  Just n | n >= 0 -> n
  _               -> error "invalid age"
```

```haskell
-- Good
data AgeError = NotANumber Text | Negative Int

parseAge :: Text -> Either AgeError Int
parseAge t = case readMaybe (unpack t) of
  Nothing -> Left (NotANumber t)
  Just n
    | n < 0     -> Left (Negative n)
    | otherwise -> Right n
```

**Source:** https://wiki.haskell.org/Error_vs._Exception

## 8. `throw` from pure code

**Avoid:** Using `throw` inside a pure value that is then returned from `IO`.
**Why:** The exception fires only when the value is forced, which may be outside the `catch` meant for it, and its ordering relative to other effects is not guaranteed.
**Instead:** Use `throwIO` in `IO`, and `evaluate` (plus `force` for deep values) when you must surface exceptions hidden in a lazy value.

```haskell
-- Bad
loadConfig :: FilePath -> IO Config
loadConfig path = do
  raw <- BS.readFile path
  pure (either (throw . ConfigError) id (parseConfig raw))
```

```haskell
-- Good
loadConfig :: FilePath -> IO Config
loadConfig path = do
  raw <- BS.readFile path
  either (throwIO . ConfigError) pure (parseConfig raw)
```

**Source:** https://hackage.haskell.org/package/base/docs/Control-Exception.html

## 9. Catching `SomeException`

**Avoid:** `catch`, `handle` or `try` with `SomeException` to supply a fallback.
**Why:** `SomeException` also matches asynchronous exceptions such as `ThreadKilled` and the one `timeout` uses, so `killThread`, `cancel` and `timeout` silently stop working.
**Instead:** Catch the specific exception type; when you need "any synchronous exception", use `catchAny`/`tryAny` from `safe-exceptions` or `unliftio`, which rethrow asynchronous ones.

```haskell
-- Bad
{-# LANGUAGE ScopedTypeVariables #-}

fetchOrDefault :: IO Price
fetchOrDefault = fetchPrice `catch` \(_ :: SomeException) -> pure defaultPrice
```

```haskell
-- Good
{-# LANGUAGE ScopedTypeVariables #-}

fetchOrDefault :: IO Price
fetchOrDefault = fetchPrice `catch` \(_ :: HttpException) -> pure defaultPrice
```

**Source:** https://hackage.haskell.org/package/base/docs/Control-Exception.html

## 10. `unsafePerformIO` for global mutable state

**Avoid:** Creating top-level `IORef`s, caches or handles with `unsafePerformIO`.
**Why:** Without a `NOINLINE` pragma GHC may inline the definition and create several separate references, common-subexpression elimination can merge distinct ones, and the hidden global makes code order-dependent and hard to test.
**Instead:** Create the state in `main` and pass it down explicitly (or through a `ReaderT` environment).

```haskell
-- Bad
counter :: IORef Int
counter = unsafePerformIO (newIORef 0)
```

```haskell
-- Good
newtype Env = Env { envCounter :: IORef Int }

nextId :: Env -> IO Int
nextId env = atomicModifyIORef' (envCounter env) (\n -> (n + 1, n))
```

**Source:** https://hackage.haskell.org/package/base/docs/System-IO-Unsafe.html

## 11. `read` on untrusted input and `Show` as a wire format

**Avoid:** Calling `read` on user, file or network input, and persisting or sending data with `show`.
**Why:** `read` throws on any malformed input; `Show` output follows constructor and field names, so a rename makes old files unreadable, and it is meant for debugging, not interchange.
**Instead:** Use `readMaybe` for parsing simple values, and an explicit codec (for example aeson's `ToJSON`/`FromJSON`) for stored or transmitted data.

```haskell
-- Bad
saveUser :: FilePath -> User -> IO ()
saveUser path user = writeFile path (show user)

loadUser :: FilePath -> IO User
loadUser path = read <$> readFile path
```

```haskell
-- Good
saveUser :: FilePath -> User -> IO ()
saveUser path = BL.writeFile path . encode

loadUser :: FilePath -> IO (Either String User)
loadUser path = eitherDecode <$> BL.readFile path
```

**Source:** https://hackage.haskell.org/package/base/docs/Text-Read.html

## 12. `String` for bulk text

**Avoid:** `String` (a linked list of `Char`) for file contents, request bodies or any text processed in volume.
**Why:** Every character is a separate heap cell, so memory use and processing time are many times higher than a packed representation.
**Instead:** Use `Data.Text` for text and `Data.ByteString` for binary data, and convert to `String` only at APIs that require it.

```haskell
-- Bad
normalize :: String -> String
normalize = map toLower . filter (not . isSpace)
```

```haskell
-- Good
import qualified Data.Text as T

normalize :: T.Text -> T.Text
normalize = T.toLower . T.filter (not . isSpace)
```

**Source:** https://hackage.haskell.org/package/text/docs/Data-Text.html

## 13. `nub` on large lists

**Avoid:** `Data.List.nub` to deduplicate lists that can grow.
**Why:** `nub` compares each element with every element kept so far, so it is quadratic and stalls on lists of a few tens of thousands.
**Instead:** Use `nubOrd` from `containers` (keeps first-occurrence order) or build a `Set` when order does not matter.

```haskell
-- Bad
uniqueIds :: [UserId] -> [UserId]
uniqueIds = nub
```

```haskell
-- Good
import Data.Containers.ListUtils (nubOrd)

uniqueIds :: [UserId] -> [UserId]
uniqueIds = nubOrd
```

**Since:** containers 0.6.0.1 (`nubOrd`)
**Source:** https://hackage.haskell.org/package/containers/docs/Data-Containers-ListUtils.html

## 14. Orphan instances

**Avoid:** Defining an instance in a module that owns neither the class nor the type.
**Why:** Whether the instance is in scope depends on imports, two libraries can define conflicting copies, and the module must be loaded even when nothing else from it is used.
**Instead:** Put the instance next to the class or the type, or wrap the type in a `newtype` you own.

```haskell
-- Bad
import Data.Csv (ToField (..))
import Payments.Types (Money (..))

instance ToField Money where
  toField (Money cents) = toField cents
```

```haskell
-- Good
newtype CsvMoney = CsvMoney Money

instance ToField CsvMoney where
  toField (CsvMoney (Money cents)) = toField cents
```

**Caught by:** GHC `-Worphans` (in `-Wall`)
**Source:** https://downloads.haskell.org/ghc/latest/docs/users_guide/using-warnings.html

## 15. Top-level bindings without type signatures

**Avoid:** Leaving top-level definitions to type inference.
**Why:** The inferred type may be more general or more specific than intended, the monomorphism restriction and defaulting can silently pick `Integer` or `Double`, and type errors surface at distant call sites.
**Instead:** Write a signature on every top-level binding and build with `-Wall`.

```haskell
-- Bad
average xs = sum xs / fromIntegral (length xs)
```

```haskell
-- Good
average :: [Double] -> Double
average xs = sum xs / fromIntegral (length xs)
```

**Caught by:** GHC `-Wmissing-signatures` and `-Wtype-defaults` (both in `-Wall`)
**Source:** https://downloads.haskell.org/ghc/latest/docs/users_guide/using-warnings.html

## 16. Hand-prefixed record field names

**Avoid:** Prefixing every field with the type name (`userName`, `teamName`) only to avoid selector clashes.
**Why:** The prefixes repeat the type name at every use, and since GHC 9.2 the compiler can tell same-named fields apart, so the workaround only adds noise.
**Instead:** On GHC 9.2 and later, use `DuplicateRecordFields` with `OverloadedRecordDot` and access fields as `x.field`.

```haskell
-- Bad
data User = User { userName :: Text, userEmail :: Text }
data Team = Team { teamName :: Text, teamOwner :: User }

ownerName :: Team -> Text
ownerName team = userName (teamOwner team)
```

```haskell
-- Good
{-# LANGUAGE DuplicateRecordFields, OverloadedRecordDot #-}

data User = User { name :: Text, email :: Text }
data Team = Team { name :: Text, owner :: User }

ownerName :: Team -> Text
ownerName team = team.owner.name
```

**Since:** GHC 9.2 (`OverloadedRecordDot`)
**Source:** https://downloads.haskell.org/ghc/latest/docs/users_guide/exts/overloaded_record_dot.html

## 17. `length xs == 0` instead of `null xs`

**Avoid:** Testing emptiness with `length xs == 0` or `xs == []`.
**Why:** `length` walks the whole structure (and never returns on an infinite list), and `== []` needs an `Eq` instance for the elements.
**Instead:** Use `null`.

```haskell
-- Bad
describeCart :: [Item] -> Text
describeCart items = if length items == 0 then "empty" else "has items"
```

```haskell
-- Good
describeCart :: [Item] -> Text
describeCart items = if null items then "empty" else "has items"
```

**Caught by:** HLint "Use null"
**Source:** https://github.com/ndmitchell/hlint/blob/master/hints.md

## Sources

- https://hackage.haskell.org/package/base/changelog
- https://downloads.haskell.org/ghc/latest/docs/users_guide/using-warnings.html
- https://wiki.haskell.org/Foldr_Foldl_Foldl%27
- https://hackage.haskell.org/package/base/docs/Data-IORef.html
- https://hackage.haskell.org/package/base/docs/System-IO.html
- https://wiki.haskell.org/Error_vs._Exception
- https://hackage.haskell.org/package/base/docs/Control-Exception.html
- https://hackage.haskell.org/package/base/docs/System-IO-Unsafe.html
- https://hackage.haskell.org/package/base/docs/Text-Read.html
- https://hackage.haskell.org/package/text/docs/Data-Text.html
- https://hackage.haskell.org/package/containers/docs/Data-Containers-ListUtils.html
- https://downloads.haskell.org/ghc/latest/docs/users_guide/exts/overloaded_record_dot.html
- https://github.com/ndmitchell/hlint/blob/master/hints.md

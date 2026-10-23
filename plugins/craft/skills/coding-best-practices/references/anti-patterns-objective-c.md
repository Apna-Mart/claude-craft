# Objective-C anti-patterns

Read this whole file before writing or reviewing Objective-C code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the Objective-C-specific traps.

## Contents

1. Strong `self` in a block that `self` keeps
2. Strong delegate properties
3. KVO without a context, a `super` call, or removal
4. `performSelector:` with a selector built at runtime
5. Messaging `nil` to hide a missing object
6. Headers without nullability annotations
7. Misusing the `NSError **` pattern
8. Assertions as production checks, and `NSAssert` inside blocks
9. Exceptions for recoverable errors
10. Non-literal format strings
11. `strong` instead of `copy` for value-like properties
12. `-isEqual:` without `-hash`
13. Comparing `NSString` with `==`
14. Treating `atomic` or `@synchronized (self)` as thread safety
15. Unprefixed category methods on framework classes
16. Accessors inside `init` and `dealloc`
17. Initializers that are not marked designated

## 1. Strong `self` in a block that `self` keeps

**Avoid:** Referencing `self`, or an instance variable such as `_items`, inside a block that `self` stores directly or through an object it owns.
**Why:** The block retains `self` and `self` retains the block, so neither is ever deallocated; an ivar reference captures `self` just as strongly as an explicit one.
**Instead:** Capture a `__weak` reference, promote it to `__strong` once at the top of the block, and return early if it is `nil`.

```objc
// Bad
self.completionHandler = ^{
    [self reloadData];
    [_spinner stopAnimating];
};
```

```objc
// Good
__weak typeof(self) weakSelf = self;
self.completionHandler = ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) { return; }
    [strongSelf reloadData];
    [strongSelf.spinner stopAnimating];
};
```

**Caught by:** Clang `-Warc-retain-cycles` (on by default), `-Wimplicit-retain-self`, `-Warc-repeated-use-of-weak` for a weak reference read several times without promotion
**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/WorkingwithBlocks/WorkingwithBlocks.html

## 2. Strong delegate properties

**Avoid:** Declaring a delegate or data source property `strong` (the default).
**Why:** The delegate usually owns the object that points back to it, so a strong back-reference forms a cycle that leaks both.
**Instead:** Declare delegates and data sources `weak`.

```objc
// Bad
@property (nonatomic) id<XYZDownloaderDelegate> delegate;
```

```objc
// Good
@property (nonatomic, weak) id<XYZDownloaderDelegate> delegate;
```

**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/EncapsulatingData/EncapsulatingData.html

## 3. KVO without a context, a `super` call, or removal

**Avoid:** Registering with `context:NULL`, handling every callback in `-observeValueForKeyPath:ofObject:change:context:`, and never calling `-removeObserver:forKeyPath:context:`.
**Why:** An observer is not removed automatically when it is deallocated, so later change notifications go to a freed object and crash; without a unique context you also swallow notifications meant for a superclass.
**Instead:** Use the address of a unique static variable as the context, forward unknown contexts to `super`, and remove the observer with the same context before either side goes away.

```objc
// Bad
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    [self updateStatus];
}
```

```objc
// Good
static void *XYZPlayerStatusContext = &XYZPlayerStatusContext;
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    if (context != XYZPlayerStatusContext) {
        [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
        return;
    }
    [self updateStatus];
}
- (void)dealloc { [_player removeObserver:self forKeyPath:@"status" context:XYZPlayerStatusContext]; }
```

**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/KeyValueObserving/Articles/KVOBasics.html

## 4. `performSelector:` with a selector built at runtime

**Avoid:** `NSSelectorFromString` plus `performSelector:` (or `performSelector:withObject:`) to dispatch actions by name under ARC.
**Why:** ARC cannot know the ownership convention of an unknown selector, so a method that returns a retained object leaks; arguments and return types are not type-checked either.
**Instead:** Map names to blocks, or call the method directly after a `respondsToSelector:` check on a known selector.

```objc
// Bad
SEL action = NSSelectorFromString(actionName);
[self performSelector:action];
```

```objc
// Good
NSDictionary<NSString *, dispatch_block_t> *actions = @{
    @"refresh": ^{ [self refresh]; },
    @"logout": ^{ [self logout]; },
};
dispatch_block_t action = actions[actionName];
if (action) { action(); }
```

**Caught by:** Clang `-Warc-performSelector-leaks` (on by default)
**Source:** https://clang.llvm.org/docs/DiagnosticsReference.html#warc-performselector-leaks

## 5. Messaging `nil` to hide a missing object

**Avoid:** Relying on messages to `nil` returning `nil`, `0` or `NO` when a `nil` receiver means something went wrong.
**Why:** The call silently does nothing, so a missing dependency or failed load reads as "empty" or "false" and the bug surfaces far away; putting that `nil` into a collection literal then throws at runtime.
**Instead:** Check for `nil` explicitly where it means failure, and keep the failure path separate from the empty path.

```objc
// Bad
NSArray<XYZItem *> *items = [self.store itemsForUser:userID];
if (items.count == 0) {
    [self showEmptyState];
}
```

```objc
// Good
NSArray<XYZItem *> *items = [self.store itemsForUser:userID];
if (items == nil) {
    [self showLoadError];
    return;
}
if (items.count == 0) {
    [self showEmptyState];
}
```

**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/WorkingwithObjects/WorkingwithObjects.html

## 6. Headers without nullability annotations

**Avoid:** Public headers whose object pointers carry no `nullable` / `nonnull` information.
**Why:** Swift imports unannotated pointers as implicitly unwrapped optionals, so a `nil` crashes Swift callers, and neither the compiler nor the analyzer can warn about `nil` passed where a value is required.
**Instead:** Wrap each header in `NS_ASSUME_NONNULL_BEGIN` / `NS_ASSUME_NONNULL_END` and mark only the genuinely optional pointers `nullable`.

```objc
// Bad
@interface XYZUserStore : NSObject
- (XYZUser *)userWithID:(NSString *)userID;
@end
```

```objc
// Good
NS_ASSUME_NONNULL_BEGIN
@interface XYZUserStore : NSObject
- (nullable XYZUser *)userWithID:(NSString *)userID;
@end
NS_ASSUME_NONNULL_END
```

**Caught by:** Clang `-Wnullability-completeness` (on by default, fires once a header uses any annotation); static analyzer `nullability.NullPassedToNonnull` and `nullability.NullReturnedFromNonnull`
**Source:** https://developer.apple.com/documentation/swift/designating-nullability-in-objective-c-apis

## 7. Misusing the `NSError **` pattern

**Avoid:** Writing through the error pointer without checking it for `NULL`, and deciding success by testing the error variable instead of the return value.
**Why:** Callers may pass `NULL`, so `*error = ...` crashes; and the return value is the only success signal, since the error is defined only when the call reports failure.
**Instead:** Guard every write with `if (error)`, return `NO` or `nil` on failure, and have callers branch on the return value only.

```objc
// Bad
- (BOOL)save:(NSError **)error {
    *error = [NSError errorWithDomain:XYZErrorDomain code:XYZErrorDiskFull userInfo:nil];
    return NO;
}
NSError *error;
[document save:&error];
if (error) { [self presentError:error]; }
```

```objc
// Good
- (BOOL)save:(NSError **)error {
    if (error) {
        *error = [NSError errorWithDomain:XYZErrorDomain code:XYZErrorDiskFull userInfo:nil];
    }
    return NO;
}
NSError *error;
if (![document save:&error]) { [self presentError:error]; }
```

**Caught by:** Clang static analyzer `osx.cocoa.NSError`
**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/ErrorHandling/ErrorHandling.html

## 8. Assertions as production checks, and `NSAssert` inside blocks

**Avoid:** Guarding real input with `NSAssert` or `NSParameterAssert`, and calling `NSAssert` inside a block.
**Why:** Both macros compile to nothing when `NS_BLOCK_ASSERTIONS` is defined or `ENABLE_NS_ASSERTIONS` is off, as it commonly is in Release, so the guard vanishes in production; `NSAssert` also expands to code that uses `self` and `_cmd`, so inside a block it captures `self` strongly.
**Instead:** Validate input with an explicit check that returns an error; inside blocks use `NSCAssert` / `NSCParameterAssert` with a weak reference.

```objc
// Bad
NSParameterAssert([amount compare:NSDecimalNumber.zero] == NSOrderedDescending);
[self.gateway charge:amount];
self.onFinish = ^{
    NSAssert(self.isLoaded, @"finished before load");
};
```

```objc
// Good
if ([amount compare:NSDecimalNumber.zero] != NSOrderedDescending) {
    return [self failWithCode:XYZErrorInvalidAmount error:error];
}
__weak typeof(self) weakSelf = self;
self.onFinish = ^{
    NSCAssert(weakSelf.isLoaded, @"finished before load");
};
```

**Caught by:** Clang `-Warc-retain-cycles` (on by default) flags the `NSAssert` capture inside a stored block
**Source:** https://developer.apple.com/documentation/foundation/nsassert

## 9. Exceptions for recoverable errors

**Avoid:** `@throw` / `@try` / `@catch` for expected failures such as missing files, bad input, or network errors.
**Why:** Cocoa reserves exceptions for programmer errors, and ARC is not exception-safe by default, so objects owned by the frames an exception unwinds through leak.
**Instead:** Return `nil` or `NO` and fill an `NSError **` parameter; let exceptions crash on true programmer errors.

```objc
// Bad
- (NSData *)loadConfig {
    NSData *data = [NSData dataWithContentsOfURL:self.configURL];
    if (!data) {
        @throw [NSException exceptionWithName:@"XYZConfigMissing" reason:@"no config" userInfo:nil];
    }
    return data;
}
```

```objc
// Good
- (nullable NSData *)loadConfig:(NSError **)error {
    return [NSData dataWithContentsOfURL:self.configURL options:0 error:error];
}
```

**Caught by:** clang-tidy `google-objc-avoid-throwing-exception`
**Source:** https://clang.llvm.org/docs/AutomaticReferenceCounting.html#exceptions

## 10. Non-literal format strings

**Avoid:** Passing a variable as the format argument of `NSLog`, `stringWithFormat:`, or `NSAssert`.
**Why:** Any `%` sequence in the data is read as a format specifier, which prints garbage from the stack or crashes when the text comes from a user or server.
**Instead:** Always use a literal format and pass the data as an argument.

```objc
// Bad
NSLog(message);
NSString *label = [NSString stringWithFormat:serverText];
```

```objc
// Good
NSLog(@"%@", message);
NSString *label = [serverText copy];
```

**Caught by:** Clang `-Wformat-security` (on by default)
**Source:** https://clang.llvm.org/docs/DiagnosticsReference.html#wformat-security

## 11. `strong` instead of `copy` for value-like properties

**Avoid:** Declaring `NSString`, `NSArray`, `NSDictionary`, or `NSSet` properties `strong`.
**Why:** A caller can pass the mutable subclass and change it later, which silently changes your object's state after it was set.
**Instead:** Declare these properties `copy`, and copy the argument yourself when you assign the ivar directly.

```objc
// Bad
@property (nonatomic, strong) NSString *title;
@property (nonatomic, strong) NSArray<XYZItem *> *items;
```

```objc
// Good
@property (nonatomic, copy) NSString *title;
@property (nonatomic, copy) NSArray<XYZItem *> *items;
```

**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/EncapsulatingData/EncapsulatingData.html

## 12. `-isEqual:` without `-hash`

**Avoid:** Overriding `-isEqual:` and keeping `NSObject`'s identity-based `-hash`.
**Why:** Equal objects must have equal hashes; otherwise `NSSet`, `NSDictionary` keys, and `-containsObject:` on hashed collections miss objects that compare equal.
**Instead:** Override `-hash` from the same fields `-isEqual:` compares.

```objc
// Bad
- (BOOL)isEqual:(id)object {
    if (![object isKindOfClass:[XYZPoint class]]) { return NO; }
    XYZPoint *other = object;
    return self.x == other.x && self.y == other.y;
}
```

```objc
// Good
- (BOOL)isEqual:(id)object {
    if (![object isKindOfClass:[XYZPoint class]]) { return NO; }
    XYZPoint *other = object;
    return self.x == other.x && self.y == other.y;
}
- (NSUInteger)hash {
    return (NSUInteger)(self.x * 31 + self.y);
}
```

**Caught by:** clang-tidy `objc-missing-hash`
**Source:** https://clang.llvm.org/extra/clang-tidy/checks/objc/missing-hash.html

## 13. Comparing `NSString` with `==`

**Avoid:** Using `==` or `!=` to compare string contents.
**Why:** `==` compares pointers; it can pass in a test because literals are uniqued, then fail for an equal string built at runtime or decoded from data.
**Instead:** Use `-isEqualToString:` (or `-isEqual:` when the type is not known to be a string).

```objc
// Bad
if (status == @"active") {
    [self activate];
}
```

```objc
// Good
if ([status isEqualToString:@"active"]) {
    [self activate];
}
```

**Caught by:** Clang `-Wobjc-string-compare` (on by default, for comparisons with a literal)
**Source:** https://clang.llvm.org/docs/DiagnosticsReference.html#wobjc-string-compare

## 14. Treating `atomic` or `@synchronized (self)` as thread safety

**Avoid:** Assuming an `atomic` property makes the object behind it thread-safe, and wrapping shared state in `@synchronized (self)`.
**Why:** `atomic` only makes the single getter or setter call whole; mutating the returned collection still races. `@synchronized` adds an implicit exception handler, and locking on `self` shares the lock with any outside code that also synchronizes on your object.
**Instead:** Keep the mutable state private and guard every access with a private lock such as `os_unfair_lock` or a private serial queue.

```objc
// Bad
@property (atomic, strong) NSMutableDictionary<NSString *, id> *cache;
- (void)storeValue:(id)value forKey:(NSString *)key {
    @synchronized (self) {
        self.cache[key] = value;
    }
}
```

```objc
// Good
@implementation XYZCache {
    os_unfair_lock _lock;
    NSMutableDictionary<NSString *, id> *_storage;
}
- (void)storeValue:(id)value forKey:(NSString *)key {
    os_unfair_lock_lock(&_lock);
    _storage[key] = value;
    os_unfair_lock_unlock(&_lock);
}
```

**Since:** iOS 10 / macOS 10.12 for `os_unfair_lock`
**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/ThreadSafety/ThreadSafety.html

## 15. Unprefixed category methods on framework classes

**Avoid:** Adding category methods with plain names to framework classes such as `NSString`, `NSArray`, or `UIView`.
**Why:** If Apple or another library adds a method with the same name, which implementation runs is undefined, and the clash appears only on some OS versions.
**Instead:** Prefix category names and their method names with your lowercase class prefix and an underscore.

```objc
// Bad
@interface NSString (Validation)
- (BOOL)isEmail;
@end
```

```objc
// Good
@interface NSString (XYZValidation)
- (BOOL)xyz_isEmail;
@end
```

**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/CustomizingExistingClasses/CustomizingExistingClasses.html

## 16. Accessors inside `init` and `dealloc`

**Avoid:** Calling `self.property = ...` or property getters from initializers and `dealloc`.
**Why:** The object is only partly built or partly torn down, and a subclass override or a KVO observer of that accessor runs against that half-valid state.
**Instead:** Read and write the backing instance variables directly in `init` and `dealloc`, copying arguments for `copy` properties yourself.

```objc
// Bad
- (instancetype)initWithName:(NSString *)name {
    self = [super init];
    if (self) {
        self.name = name;
    }
    return self;
}
```

```objc
// Good
- (instancetype)initWithName:(NSString *)name {
    self = [super init];
    if (self) {
        _name = [name copy];
    }
    return self;
}
```

**Source:** https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/MemoryMgmt/Articles/mmPractical.html

## 17. Initializers that are not marked designated

**Avoid:** Declaring a required-argument initializer without `NS_DESIGNATED_INITIALIZER` and leaving the inherited `-init` callable.
**Why:** `[[XYZSession alloc] init]` still compiles and produces an object with its required state missing, and subclasses can skip your initializer.
**Instead:** Mark the real initializer `NS_DESIGNATED_INITIALIZER` and make the inherited ones `NS_UNAVAILABLE`.

```objc
// Bad
@interface XYZSession : NSObject
- (instancetype)initWithToken:(NSString *)token;
@end
```

```objc
// Good
@interface XYZSession : NSObject
- (instancetype)initWithToken:(NSString *)token NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (instancetype)new NS_UNAVAILABLE;
@end
```

**Source:** https://developer.apple.com/library/archive/releasenotes/ObjectiveC/ModernizationObjC/AdoptingModernObjective-C/AdoptingModernObjective-C.html

## Sources

- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/WorkingwithBlocks/WorkingwithBlocks.html
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/EncapsulatingData/EncapsulatingData.html
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/KeyValueObserving/Articles/KVOBasics.html
- https://clang.llvm.org/docs/DiagnosticsReference.html#warc-performselector-leaks
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/WorkingwithObjects/WorkingwithObjects.html
- https://developer.apple.com/documentation/swift/designating-nullability-in-objective-c-apis
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/ErrorHandling/ErrorHandling.html
- https://developer.apple.com/documentation/foundation/nsassert
- https://clang.llvm.org/docs/AutomaticReferenceCounting.html#exceptions
- https://clang.llvm.org/docs/DiagnosticsReference.html#wformat-security
- https://clang.llvm.org/extra/clang-tidy/checks/objc/missing-hash.html
- https://clang.llvm.org/docs/DiagnosticsReference.html#wobjc-string-compare
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/ThreadSafety/ThreadSafety.html
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/CustomizingExistingClasses/CustomizingExistingClasses.html
- https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/MemoryMgmt/Articles/mmPractical.html
- https://developer.apple.com/library/archive/releasenotes/ObjectiveC/ModernizationObjC/AdoptingModernObjective-C/AdoptingModernObjective-C.html
- https://clang.llvm.org/docs/analyzer/checkers.html
- https://clang.llvm.org/extra/clang-tidy/checks/google/objc-avoid-throwing-exception.html

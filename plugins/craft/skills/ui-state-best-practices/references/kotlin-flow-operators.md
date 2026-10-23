# Kotlin Flow: picking the latest-wins operator

Detail for Rule 12 (*Stay consistent under concurrency — latest wins*) of `ui-state-best-practices`, for Kotlin and Compose code.

Pick the right Kotlin operator by what the transform returns — getting this wrong is a common, subtle bug:

- **`flatMapLatest { q -> ... }`** when the transform returns a **`Flow`** that emits more than once — e.g. `flow { emit(Loading); emit(Success(api.search(q))) }`. A new query cancels the previous inner flow mid-stream. This is the right choice for a search pipeline that shows a loading state.
- **`mapLatest { q -> api.search(q) }`** when the transform is a **single `suspend` call returning one value**. A new query cancels the in-flight suspend lambda; it emits only the final result, no intermediate loading state.
- **`collectLatest { }`** in a terminal collector when you just want the body re-run (and the prior run cancelled) per emission, not a new flow.

```kotlin
val results: StateFlow<SearchState> =
    query
        .debounce(300)
        .distinctUntilChanged()
        .flatMapLatest { q ->                       // returns a Flow → flatMapLatest
            flow {
                emit(SearchState.Loading)
                emit(SearchState.Loaded(api.search(q)))   // api.search is a single suspend call
            }.catch { emit(SearchState.Error(it.message.orEmpty())) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SearchState.Idle)
```

All three cancel the previous work — they differ only in whether the lambda yields a stream or a single value. Note that `flatMapLatest` and `mapLatest` are still `@ExperimentalCoroutinesApi`: add `@OptIn(ExperimentalCoroutinesApi::class)` or a project-wide `compilerOptions.optIn` entry, or this won't compile clean.

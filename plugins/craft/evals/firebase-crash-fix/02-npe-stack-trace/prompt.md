---
name: "firebase-crash-fix/npe-stack-trace"
tags: ["firebase-crash-fix", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

This crash is all over Crashlytics (3.14.0 (412), Android 10 to 14). Fix it. The repo isn't on this machine, so here's the code involved:

java.lang.NullPointerException: Attempt to invoke virtual method 'long com.example.shop.Cart.getTotal()' on a null object reference
    at com.example.shop.OrderScreen.submit(OrderScreen.kt:88)
    at com.example.shop.OrderScreen.onConfirm(OrderScreen.kt:54)

```kotlin
// OrderScreen.kt
53  fun onConfirm() {
54      submit(viewModel.order.value ?: return)
55  }
86  private fun submit(order: Order) {
87      analytics.log("submit", order.id)
88      api.place(PlaceOrder(order.id, order.cart.total))
89  }

// Order.kt
data class Order(val id: String, val status: String, val cart: Cart)
data class Cart(val total: Long, val items: List<Item>)

// OrderRepository.kt
suspend fun load(id: String): Order =
    gson.fromJson(api.getOrder(id).string(), Order::class.java)

// OrderViewModel.kt
fun open(orderId: String) = viewModelScope.launch {
    order.value = repository.load(orderId)
}
```

The "finish your order" push notification opens an order by ID. Backend docs: `cart` is left out of `GET /orders/{id}` for orders that have no items yet.

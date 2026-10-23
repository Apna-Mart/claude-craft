---
name: "firebase-crash-fix/flutter-plugin-crash"
tags: ["firebase-crash-fix", "trigger"]
allowed_tools: ["Read", "Glob", "Grep", "Skill"]
---

Crashlytics keeps reporting this from our Flutter app (iOS and Android, v2.3.1+41). Fix it. Code and lockfile excerpts below; the repo isn't on this machine.

Fatal Exception: DatabaseException(database_closed)
#0  SqfliteDatabaseMixin.checkNotClosed (package:sqflite_common/src/database_mixin.dart:446)
#1  SqfliteDatabaseMixin.txnRawQuery (package:sqflite_common/src/database_mixin.dart:391)
#2  CartDao.loadItems (package:shop/data/cart_dao.dart:58)
#3  CartRepository.refresh (package:shop/data/cart_repository.dart:22)

```dart
// lib/data/app_database.dart
class AppDatabase {
  static Database? _db;
  static Future<Database> get instance async => _db ??= await openDatabase('shop.db');
  static Future<void> close() async => _db?.close();
}

// lib/app.dart
@override
void didChangeAppLifecycleState(AppLifecycleState state) {
  if (state == AppLifecycleState.paused) AppDatabase.close();
  if (state == AppLifecycleState.resumed) cartRepository.refresh();
}

// lib/data/cart_dao.dart
56  Future<List<CartItem>> loadItems() async {
57    final db = await AppDatabase.instance;
58    final rows = await db.rawQuery('SELECT * FROM cart_items');
59    return rows.map(CartItem.fromRow).toList();
60  }
```

```yaml
# pubspec.lock
  sqflite:
    version: "2.3.3"
  sqflite_common:
    version: "2.5.4"
```

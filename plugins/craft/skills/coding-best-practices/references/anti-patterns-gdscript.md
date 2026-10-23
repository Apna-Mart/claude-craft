# GDScript anti-patterns

Read this whole file before writing or reviewing GDScript code. Avoid every pattern below in code you write, and flag the ones you find in review. The language-neutral rules in `SKILL.md` still apply; this file adds the GDScript-specific traps. Everything here targets Godot 4; Godot 3 idioms are called out where they still show up in ported code.

## Contents

1. `free()` on a node that is still in use
2. `as` casts that silently return `null`
3. Untyped variables, parameters and returns
4. `yield` or a coroutine called without `await`
5. Movement and physics in `_process`
6. Discarding a returned `Error`
7. Long `get_node` paths looked up every frame
8. Polling one-shot input in `_process`
9. Polling state every frame instead of reacting to a signal
10. String-based `connect` and `emit_signal`
11. `load()` in gameplay code
12. Comparing floats with `==`
13. Integer division where a fraction is wanted
14. Children reaching up with `get_parent()` and `../`
15. Autoload god objects
16. Names that shadow base-class members

## 1. `free()` on a node that is still in use

**Avoid:** calling `free()` on a node, or keeping a reference to a node another system may free.
**Why:** `free()` deletes at once, so the rest of the current function, pending signal handlers and physics callbacks hit a freed instance and error out.
**Instead:** use `queue_free()`, which deletes at the end of the frame and is safe to call twice, and guard stored references with `is_instance_valid()`.

```gdscript
# Bad
func _on_hurtbox_hit() -> void:
	free()
	died.emit()
```

```gdscript
# Good
func _on_hurtbox_hit() -> void:
	died.emit()
	queue_free()
```

**Source:** https://docs.godotengine.org/en/stable/classes/class_node.html

## 2. `as` casts that silently return `null`

**Avoid:** casting with `as` to a node or custom class and using the result without checking it.
**Why:** a failed `as` cast to an object type gives `null` with no error, so the failure shows up later as "Attempt to call ... on a null instance", far from the cause.
**Instead:** check the cast result (or test with `is`) and handle the mismatch where it happens.

```gdscript
# Bad
func _on_body_entered(body: Node2D) -> void:
	var player := body as Player
	player.take_hit(10)
```

```gdscript
# Good
func _on_body_entered(body: Node2D) -> void:
	var player := body as Player
	if player == null:
		return
	player.take_hit(10)
```

**Source:** https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/static_typing.html

## 3. Untyped variables, parameters and returns

**Avoid:** declaring variables, parameters, return types and arrays without static types.
**Why:** a typo or wrong type only fails when that line runs, often in a rarely hit branch, and untyped code cannot use the faster typed opcodes.
**Instead:** type every declaration, use `:=` where the type is obvious, and use typed arrays and dictionaries.

```gdscript
# Bad
var speed = 200
var enemies = []

func damage(target, amount):
	target.health -= amount
```

```gdscript
# Good
var speed: float = 200.0
var enemies: Array[Enemy] = []

func damage(target: Enemy, amount: int) -> void:
	target.health -= amount
```

**Caught by:** GDScript warnings `UNTYPED_DECLARATION` (Godot 4.2+), `UNSAFE_PROPERTY_ACCESS`, `UNSAFE_METHOD_ACCESS`, `UNSAFE_CALL_ARGUMENT`, `INFERENCE_ON_VARIANT`; the first four are off by default, enable them under Project Settings > Debug > GDScript
**Since:** Godot 4.0 (typed arrays); Godot 4.4 (typed dictionaries, `Dictionary[String, int]`)
**Source:** https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/static_typing.html

## 4. `yield` or a coroutine called without `await`

**Avoid:** porting Godot 3 `yield(...)` code, or calling a function that contains `await` without awaiting it.
**Why:** `yield` does not exist in Godot 4, and a coroutine called without `await` returns at its first `await`, so the caller races ahead of the work it depends on.
**Instead:** use `await` on signals and coroutines, and `await` every coroutine whose completion the next line depends on.

```gdscript
# Bad
func _ready() -> void:
	play_intro()
	start_level()
```

```gdscript
# Good
func _ready() -> void:
	await play_intro()
	start_level()
```

**Caught by:** GDScript warning `MISSING_AWAIT` (Godot 4.6+, off by default)
**Since:** Godot 4.0 (`await` replaces `yield`)
**Source:** https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html

## 5. Movement and physics in `_process`

**Avoid:** moving physics bodies in `_process`, setting `position` directly on a body, or applying per-frame amounts without `delta`.
**Why:** `_process` runs at the frame rate, so speed changes with FPS, and setting `position` skips collision.
**Instead:** move bodies in `_physics_process` through `velocity` and `move_and_slide()`, and multiply by `delta` for anything you integrate yourself.

```gdscript
# Bad
extends CharacterBody2D

func _process(_delta: float) -> void:
	position += Input.get_vector("left", "right", "up", "down") * 5
```

```gdscript
# Good
extends CharacterBody2D

const SPEED := 300.0

func _physics_process(_delta: float) -> void:
	velocity = Input.get_vector("left", "right", "up", "down") * SPEED
	move_and_slide()
```

**Source:** https://docs.godotengine.org/en/stable/tutorials/scripting/idle_and_physics_processing.html

## 6. Discarding a returned `Error`

**Avoid:** ignoring the `Error` value returned by engine calls such as `ResourceSaver.save` or `DirAccess.make_dir_recursive_absolute`.
**Why:** Godot reports many failures only through the return value, so a failed save or a missing directory goes unnoticed until data is lost.
**Instead:** compare the result with `OK` and report or handle the failure.

```gdscript
# Bad
func save_settings(settings: Resource) -> void:
	ResourceSaver.save(settings, "user://settings.tres")
```

```gdscript
# Good
func save_settings(settings: Resource) -> void:
	var error := ResourceSaver.save(settings, "user://settings.tres")
	if error != OK:
		push_error("Saving settings failed: %s" % error_string(error))
```

**Caught by:** GDScript warning `RETURN_VALUE_DISCARDED` (off by default; it also fires on calls whose result is usually ignored, such as `connect()` and `move_and_slide()`, so use it for a review pass rather than leaving it on)
**Source:** https://docs.godotengine.org/en/stable/classes/class_resourcesaver.html

## 7. Long `get_node` paths looked up every frame

**Avoid:** `get_node("A/B/C/D")` or `$A/B/C/D` inside `_process` or `_physics_process`.
**Why:** the tree is walked on every call, and the path fails at runtime the moment someone moves or renames a node in the scene.
**Instead:** cache the node once in an `@onready` typed variable, and use a scene unique name (`%Name`) so the path survives reparenting inside the scene.

```gdscript
# Bad
func _process(_delta: float) -> void:
	$Body/Arm/Weapon/Muzzle.look_at(get_global_mouse_position())
```

```gdscript
# Good
@onready var muzzle: Marker2D = %Muzzle

func _process(_delta: float) -> void:
	muzzle.look_at(get_global_mouse_position())
```

**Source:** https://docs.godotengine.org/en/stable/tutorials/scripting/scene_unique_nodes.html

## 8. Polling one-shot input in `_process`

**Avoid:** checking discrete actions such as pause, jump or interact with `Input.is_action_just_pressed` in `_process`.
**Why:** polling ignores the GUI, so a key press that a focused text field or menu already used also fires the gameplay action.
**Instead:** handle discrete gameplay actions in `_unhandled_input` and mark them handled; keep polling the `Input` singleton for held, continuous input such as movement.

```gdscript
# Bad
func _process(_delta: float) -> void:
	if Input.is_action_just_pressed("pause"):
		toggle_pause()
```

```gdscript
# Good
func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		toggle_pause()
		get_viewport().set_input_as_handled()
```

**Source:** https://docs.godotengine.org/en/stable/tutorials/inputs/inputevent.html

## 9. Polling state every frame instead of reacting to a signal

**Avoid:** checking in `_process` whether some other object's value has changed.
**Why:** the check costs every frame on every instance, and one-time reactions inside it (game over, a sound) fire again on every frame the condition holds.
**Instead:** have the owner emit a signal when the value changes and react in the handler; use a `Timer` or `create_timer` for delays, and `set_process(false)` on nodes with nothing to do.

```gdscript
# Bad
func _process(_delta: float) -> void:
	health_bar.value = player.health
	if player.health <= 0:
		show_game_over()
```

```gdscript
# Good
func _ready() -> void:
	player.health_changed.connect(_on_health_changed)

func _on_health_changed(new_health: int) -> void:
	health_bar.value = new_health
	if new_health <= 0:
		show_game_over()
```

**Source:** https://docs.godotengine.org/en/stable/getting_started/step_by_step/signals.html

## 10. String-based `connect` and `emit_signal`

**Avoid:** connecting and emitting signals by name, such as `connect("pressed", Callable(self, "_on_pressed"))` or `emit_signal("died")`, and the Godot 3 three-argument `connect`.
**Why:** a misspelled signal or method name is only caught when that line runs, and the editor cannot find or rename string references.
**Instead:** use the signal and callable objects: `button.pressed.connect(_on_pressed)`, `died.emit()`, and `.bind(...)` for extra arguments.

```gdscript
# Bad
func _ready() -> void:
	$StartButton.connect("pressed", Callable(self, "_on_start_pressed"))
	emit_signal("menu_opened")
```

```gdscript
# Good
@onready var start_button: Button = %StartButton

func _ready() -> void:
	start_button.pressed.connect(_on_start_pressed)
	menu_opened.emit()
```

**Source:** https://docs.godotengine.org/en/stable/classes/class_object.html

## 11. `load()` in gameplay code

**Avoid:** calling `load("res://...")` with a constant path inside gameplay functions such as firing or spawning.
**Why:** a resource not yet referenced is read from disk on that call, which stalls the frame mid-gameplay, and a wrong path only fails when the code runs.
**Instead:** `preload` constant paths into a `const`, and use `ResourceLoader.load_threaded_request` for large resources chosen at runtime.

```gdscript
# Bad
func fire() -> void:
	var bullet: Node2D = load("res://bullet.tscn").instantiate()
	add_child(bullet)
```

```gdscript
# Good
const BULLET_SCENE: PackedScene = preload("res://bullet.tscn")

func fire() -> void:
	var bullet: Node2D = BULLET_SCENE.instantiate()
	add_child(bullet)
```

**Source:** https://docs.godotengine.org/en/stable/classes/class_@gdscript.html

## 12. Comparing floats with `==`

**Avoid:** testing floats, vectors or results of float math with `==` or `!=`.
**Why:** rounding error makes values that should be equal differ in the last bits, so the branch never fires.
**Instead:** use `is_equal_approx` and `is_zero_approx`, which both exist for `float` and for vector types.

```gdscript
# Bad
if velocity.length() == 0.0:
	state = State.IDLE
if progress == 1.0:
	finish()
```

```gdscript
# Good
if velocity.is_zero_approx():
	state = State.IDLE
if is_equal_approx(progress, 1.0):
	finish()
```

**Source:** https://docs.godotengine.org/en/stable/classes/class_@globalscope.html

## 13. Integer division where a fraction is wanted

**Avoid:** dividing two `int` values when you need a fractional result.
**Why:** `int / int` truncates, so `hits / shots` is `0` for any hit rate below 100%.
**Instead:** convert one operand to `float` before dividing.

```gdscript
# Bad
var accuracy := hits / shots
```

```gdscript
# Good
var accuracy := float(hits) / shots
```

**Caught by:** GDScript warning `INTEGER_DIVISION` (on by default)
**Source:** https://docs.godotengine.org/en/stable/classes/class_projectsettings.html

## 14. Children reaching up with `get_parent()` and `../`

**Avoid:** a child node that calls into its parent or siblings through `get_parent()` chains or `../` paths.
**Why:** the child breaks as soon as it is reused in another scene or the tree is reorganised, and the coupling is invisible from the parent.
**Instead:** let the child emit a signal and let the parent decide what happens; the parent passes down any references the child needs.

```gdscript
# Bad
func _on_body_entered(_body: Node2D) -> void:
	get_parent().get_parent().score += 1
	get_node("../HUD").refresh()
```

```gdscript
# Good
signal collected

func _on_body_entered(_body: Node2D) -> void:
	collected.emit()
```

**Source:** https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html

## 15. Autoload god objects

**Avoid:** one autoload that holds player state, UI references, audio and level data, reached from everywhere.
**Why:** any script can change any of it, so a bug's search space is the whole project, and one failure in the autoload breaks every caller.
**Instead:** keep state in the scene that owns it and connect through signals; keep autoloads for broad, self-contained systems, and use `static var` or `class_name` static functions for shared values and helpers.

```gdscript
# Bad
func _on_hit(amount: int) -> void:
	Game.player_health -= amount
	Game.hud.update_health(Game.player_health)
	Game.audio.play("res://sfx/hit.wav")
```

```gdscript
# Good
signal health_changed(new_health: int)

var health: int = 100

func _on_hit(amount: int) -> void:
	health -= amount
	health_changed.emit(health)
```

**Since:** Godot 4.1 (`static var`)
**Source:** https://docs.godotengine.org/en/stable/tutorials/best_practices/autoloads_versus_regular_nodes.html

## 16. Names that shadow base-class members

**Avoid:** naming variables or parameters after inherited properties such as `position`, `name`, `scale` or `visible`.
**Why:** inside that scope the name refers to your local, not the node's property, so assignments silently miss the node.
**Instead:** pick a name that says what the value is, such as `target_position`.

```gdscript
# Bad
extends Node2D

func spawn_at(position: Vector2) -> void:
	position = position.snapped(Vector2(16, 16))
```

```gdscript
# Good
extends Node2D

func spawn_at(target_position: Vector2) -> void:
	position = target_position.snapped(Vector2(16, 16))
```

**Caught by:** GDScript warnings `SHADOWED_VARIABLE_BASE_CLASS`, `SHADOWED_VARIABLE`, `SHADOWED_GLOBAL_IDENTIFIER` (on by default)
**Source:** https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/warning_system.html

## Sources

- https://docs.godotengine.org/en/stable/classes/class_node.html
- https://docs.godotengine.org/en/stable/classes/class_object.html
- https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/static_typing.html
- https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html
- https://docs.godotengine.org/en/stable/tutorials/scripting/idle_and_physics_processing.html
- https://docs.godotengine.org/en/stable/classes/class_resourcesaver.html
- https://docs.godotengine.org/en/stable/tutorials/scripting/scene_unique_nodes.html
- https://docs.godotengine.org/en/stable/tutorials/inputs/inputevent.html
- https://docs.godotengine.org/en/stable/getting_started/step_by_step/signals.html
- https://docs.godotengine.org/en/stable/classes/class_@gdscript.html
- https://docs.godotengine.org/en/stable/classes/class_resourceloader.html
- https://docs.godotengine.org/en/stable/classes/class_@globalscope.html
- https://docs.godotengine.org/en/stable/classes/class_projectsettings.html
- https://docs.godotengine.org/en/stable/tutorials/best_practices/scene_organization.html
- https://docs.godotengine.org/en/stable/tutorials/best_practices/autoloads_versus_regular_nodes.html
- https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/warning_system.html

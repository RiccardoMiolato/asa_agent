# Style Guide — Typing as Architecture

> **Core principle**: The type system is the architecture. People talk about "self-documenting code"
> at the line level — good variable names, clear logic. We aim for **self-documenting architecture**:
> the class hierarchies, type annotations, and module boundaries should make the entire codebase
> navigable and comprehensible through the IDE alone. "Go to Definition → Find All Implementations"
> should be enough to understand what a thing is, where it lives, and how it connects to everything
> else. If that chain breaks anywhere, the structure is wrong.
>
> Code that "works" but ignores these principles is not acceptable; it creates unmaintainable
> islands that eventually rot and drag down the whole repo.

---

## Table of Contents

1. [Philosophy](#1-philosophy)
2. [File Organization](#2-file-organization)
3. [Naming Conventions](#3-naming-conventions)
4. [Typing as Architecture](#4-typing-as-architecture)
5. [Class Design & Inheritance](#5-class-design--inheritance)
6. [`__init__.py` as Documentation & Public API](#6-__init__py-as-documentation--public-api)
7. [Import Discipline](#7-import-discipline)
8. [Error Handling](#8-error-handling)
9. [Patterns to Avoid (Anti-patterns)](#9-patterns-to-avoid-anti-patterns)

---

## 1. Philosophy

### 1.1 — Code is read 100× more than it is written

Optimize for comprehension by future readers (including yourself in 3 months). Every structural
decision — file placement, class hierarchy, naming — should make the codebase **navigable via the
IDE's type system**. If someone can't "Go to Definition → Find All Implementations" and
immediately understand what a thing is and where it's used, the structure is wrong.

### 1.2 — Structure-first approach

A class with a `@staticmethod` inheriting from an abstract base class is 100× better than a
standalone function, even if the function "works". The class approach lets you:
- See all implementations of that concept via "Find All Implementations" in the IDE.
- Understand at a glance that they share a role/contract.
- Refactor the contract in one place and have the type checker catch all call sites.

Standalone functions scattered across files are invisible to the type system and create
incomprehensible, disconnected code islands.

### 1.3 — AI-generated code must follow these rules

AI tools produce syntactically correct but structurally random code. Before committing
AI-generated code, you must:
1. Verify it follows the class hierarchies and patterns already in the repo.
2. Place it in the correct module/file per our organization rules.
3. Add full type annotations.
4. Use existing base classes — don't reinvent the wheel.

If the AI produces a standalone function where a class inheriting from an existing base is
expected, rewrite it. The person committing AI-generated code owns it — "the AI wrote it"
is not an excuse for structural violations or bugs.

---

## 2. File Organization

### 2.1 — Underscore prefix for private modules

Files that are implementation details (not part of the public API) are prefixed with `_`:

```
actions/
├── __init__.py          # public exports
├── _base.py             # BaseAction class (private)
├── _agents.py           # CodeAgent implementation (private)
├── _tools.py            # BaseTool implementation (private)
├── _config.py           # configuration for this module (private)
```

The `__init__.py` re-exports what callers need. External code imports from the package, not
from `_base.py` directly.

### 2.2 — Vertical vs horizontal organization: follow the dependency fan-out

The deciding factor is **how many consumers a piece of code has**:

- **One-to-one** (a file exists to serve one feature) → **colocate** it with that feature.
- **Many-to-one** (a file is consumed by many unrelated features) → **extract** it into a shared location.

**Vertical (colocated)** — When templates, config, and logic all serve one feature, keep them
together. Understanding "notifications" means opening one directory:
```
notifications/
├── _service.py          # notification service class
├── _templates.py        # message templates (only used by this service)
├── _channels.py         # delivery channels (email, SMS, push)
├── _utils.py            # notification-specific utils
```

**Horizontal (shared)** — When an email service is consumed by notifications, billing, auth,
onboarding, etc., it belongs in a shared location. Duplicating it per consumer would be worse:
```
services/
├── email.py             # shared email service (used by 5+ modules)
├── sms.py               # shared SMS service
```

**The anti-pattern** is horizontal splitting where there's no real sharing — scattering files
across `templates/`, `configs/`, `services/` when each piece only serves one feature:
```
# BAD — everything here is 1:1 with notifications, but spread across 3 directories
templates/notification_templates.py
configs/notification_config.py
services/notification_service.py
```

**Rule of thumb**: before placing a file in a shared/horizontal directory, ask "does anything
*other than the feature I'm building* need this?" If the answer is no, colocate it.

### 2.3 — One concept per file, but keep related concepts close

Each file should have a clear, singular purpose:
- `_base.py` — base classes for a sub-package
- `_types.py` — type definitions (enums, TypedDicts, NewTypes)
- `_config.py` — configuration for the module
- `_utils.py` — small utility functions specific to the module

If a file grows beyond ~1000 lines, consider whether it contains multiple logical concepts that
should be split. But never split just to reduce line count — split when there are genuinely
separable concerns.

### 2.4 — Section separators for large files

Use banner comments to separate logical sections within large files:

```python
#######################################################################################
# PRIVATE FUNCTIONS
#######################################################################################

def _private_fn(...):
  pass

#######################################################################################
# PUBLIC INTERFACES
#######################################################################################
```

This provides visual navigation when scrolling through files with many related definitions.
Within classes you can use `# --- XYZ Methods ---`

---

## 3. Naming Conventions

Consistent naming lets you identify *what kind of thing* something is before reading it.

| Pattern | Meaning | Example |
|---|---|---|
| `T*` | DB entity / data model | `TConversation`, `TMessage`, `TUser` |
| `Base*` | Abstract base class | `BaseExecutionBroker`, `BaseExecutor` |
| `*Factory` | Factory class | `ProviderFactory`, `StripeProviderFactory` |
| `UPPER_SNAKE` | Constants, enum-like classes | `TASK_STATUS`, `MAX_RETRIES` |
| `_filename.py` | Private module (not re-exported) | `_base.py`, `_utils.py`, `_types.py` |
| `_function` | Private helper function | `_validate_input()`, `_parse_response()` |

---

## 4. Typing as Architecture

> The type system isn't just for catching bugs — it's **the primary tool for understanding
> the codebase**. Types define contracts, hierarchies reveal architecture, and annotations
> make every function's role immediately apparent. A well-typed codebase is one where you
> never need to `grep` to understand how things connect — the IDE does it for you.

### 4.1 — Everything is fully typed

All function signatures must have complete type annotations — parameters and return types.
No `Any` unless genuinely unavoidable (e.g., interfacing with untyped libraries). When `Any`
is necessary, add a `# type: ignore` comment or a pyright directive explaining why.

```python
# GOOD
def fetch_conversations(db: DatabaseClient, user_id: str, limit: int = 32) -> list[TConversation]: ...

# BAD
def fetch_conversations(db, user_id, limit=32): ...
```

The typed version tells you exactly what goes in, what comes out, and lets you navigate to
`TConversation` to understand the shape. The untyped version tells you nothing.

### 4.2 — Use `NewType` to prevent semantic mixing

When multiple parameters share the same primitive type but represent different concepts,
use `NewType` to make them distinct:

```python
from typing import NewType

OrderId = NewType("OrderId", str)       # public-facing order reference
InvoiceId = NewType("InvoiceId", str)   # internal billing identifier
CustomerId = NewType("CustomerId", str) # user account identifier
```

This prevents accidentally passing an `OrderId` where a `CustomerId` is expected.
The compiler catches the mix-up; without `NewType`, it's just `str` everywhere and anything
goes.

### 4.3 — Use `TypedDict` for structured dictionaries

When a dictionary has a known schema, define a `TypedDict`:

```python
class GeoLocation(TypedDict):
    lat: float
    lng: float

class ShippingInfo(TypedDict):
    address: str
    location: NotRequired[GeoLocation]
    tracking_id: str | None
```

Never pass around untyped `dict[str, Any]` when the shape is known. A `TypedDict` is
self-documenting — you can inspect its definition to know exactly what keys exist and
what types they hold.

### 4.4 — Use `Literal` for constrained strings

```python
from typing import TypeAlias, Literal
from dataclasses import dataclass, field

Device: TypeAlias = Literal["mobile", "desktop"]

@dataclass
class SessionConfig:
  device: Device = field(default="mobile")
```

### 4.5 — Use `Enum` for finite sets of values

```python
from enum import IntEnum, StrEnum, auto

# IntEnum — when you need ordering/comparison
class TASK_STATUS(IntEnum):  # noqa: N801
    WAITING = 0
    RUNNING = 1
    DONE = 2

# StrEnum — when values should be auto-generated lowercase strings
class TASK_TYPE(StrEnum):  # noqa: N801
    DISCOVERY = auto()
    AUTOMATION = auto()
```

Prefer enums over raw strings or ints for anything with a fixed set of valid values.

### 4.6 — Pyright strict mode

The repo uses `pyright` in strict mode (`typeCheckingMode = "strict"`). All code must pass
strict type checking. Use `# type: ignore` sparingly.

```toml
[tool.pyright]
typeCheckingMode = "strict"
reportMissingTypeStubs = false
reportIncompatibleMethodOverride = false
```

Strict typing enforces multiple constraints. For example,
every module, class, and public function needs a docstring:

```python
"""Task execution environment."""

class DockerCodeExecutor(BaseExecutor):
    """Execute code in Docker containers via Jupyter kernel.

    Args:
        kernel_manager: Kernel manager to use.
        additional_imports: Additional imports to install.
        log: Logger instance.
    """
```

### 4.7 — Types guide navigation

The type system is your primary navigation tool. When reading unfamiliar code:
1. Look at the class hierarchy ("What does this inherit from?")
2. Use "Find All Implementations" on base classes to see the full family
3. Use "Go to Definition" on types to understand the contract

This only works if the codebase is consistently typed. A single untyped function breaks the
chain.

---

## 5. Class Design & Inheritance

### 5.1 — Abstract base classes define contracts

Use base classes to define the role/contract of a family of implementations, even if the
base class is nearly empty:

```python
from abc import ABC, abstractmethod

class BaseExecutionBroker(ABC):
    """Base for code execution brokers."""
    @abstractmethod
    def exec(self, code: str | None, action: str | None = None, payload: dict | None = None) -> Any:
        ...

    @abstractmethod
    def close(self) -> None:
        ...

class JupyterExecutionBroker(BaseExecutionBroker):
    """Broker that executes code via Jupyter kernel."""
    ...

class RemoteExecutionBroker(BaseExecutionBroker):
    """Broker that executes code on a remote sandbox."""
    ...
```

Now anyone can "Find All Implementations" of `BaseExecutionBroker` to see every execution
backend available. This is typing as architecture in action — the base class is a navigable
map of the system's capabilities.

> **Note on `Protocol`**: Use `Protocol` (structural subtyping) only when you can't enforce
> inheritance — e.g., typing a callback shape or a third-party object you don't control.
> For internal code, prefer ABCs: they're discoverable via "Find All Implementations."

### 5.2 — Factory pattern for pluggable creation

Use factory classes when you need to create different implementations based on runtime config:

```python
class ProviderFactory(ABC):
    """Factory class to create provider integrations."""
    @staticmethod
    @abstractmethod
    def make(id: str, config: ProviderConfig, ...) -> ProviderClient:
        ...

class StripeProviderFactory(ProviderFactory):
    @staticmethod
    def make(...) -> ProviderClient:
        ...  # creates a Stripe-specific client

class PayPalProviderFactory(ProviderFactory):
    @staticmethod
    def make(...) -> ProviderClient:
        ...  # creates a PayPal-specific client
```

Then, for example, register them in a typed dictionary:

```python
PROVIDERS: dict[str, Type[ProviderFactory]] = {
    "stripe": StripeProviderFactory,
    "paypal": PayPalProviderFactory,
    "manual": ManualProviderFactory,
}
```

This keeps creation logic organized, typed, and discoverable.

### 5.3 — `@staticmethod` for entity operations

For entity/data model classes, keep related operations as static methods on the class:

```python
class TConversation(BaseModel):
    @staticmethod
    def create(db: DatabaseClient, workspace_id: str, title: str, t: int) -> "TConversation": ...

    @staticmethod
    def get(db: DatabaseClient, workspace_id: str, t: int) -> "TConversation | None": ...

    @staticmethod
    def update(db: DatabaseClient, workspace_id: str, t: int, **fields: Any) -> bool: ...

    @staticmethod
    def delete(db: DatabaseClient, workspace_id: str, t: int) -> "TConversation | None": ...

    @staticmethod
    def fetch(db: DatabaseClient, workspace_id: str, limit: int, t: int) -> list["TConversation"]: ...
```

This keeps all operations on a Conversation discoverable under the `TConversation` class.
**Do not** scatter entity operations as standalone functions in random utility files.

---

## 6. `__init__.py` as Documentation & Public API

### 6.1 — Every `__init__.py` defines the public surface

The `__init__.py` file should:
1. Import and re-export the public symbols from the sub-package.
2. Define `__all__` listing every exported name.
3. Have a docstring describing the module's purpose including:
  1. A summary of what the package/directory does.
  2. A tree diagram of the directory contents.
  3. A brief (1-2 sentence) explanation of each file/subdirectory.

```python
"""Actions — Task and tool execution framework.

Directory structure:
├── _base.py           # BaseAction class: logging, approval, action tracking
├── _agents.py         # CodeAgent: code-executing agent with report generation
├── _tools.py          # BaseTool: base class for all tools with execution wrapping
├── _config.py         # Configuration templates for code and tool-calling agents
├── builtin_tools/     # Built-in tools available to all agents (final_answer, llm, etc.)
├── tools/             # Standalone tools (search, web scrape, external APIs)
└── providers/         # Provider factories that create integration-specific configurations
    ├── _base.py       # ProviderFactory + ProviderConfig: factory pattern for providers
    ├── _stripe.py     # Stripe integration
    ├── _paypal.py     # PayPal integration
    └── _manual.py     # Manual / custom provider
"""
```

This makes every directory self-documenting — a new team member can open `__init__.py` and
immediately understand what they're looking at.

---

## 7. Import Discipline

### 7.1 — Never import upward

Lower-level modules must never import from higher-level ones. If the dependency graph is
`api → orchestrator → engine → core`, then `core` must never import from `engine`,
and `engine` must never import from `api`. If you need something from a higher layer in a
lower one, **push the abstraction down** (create a base class or Protocol in the lower module)
or restructure.

### 7.2 — Import from packages, not private modules

```python
# GOOD
from engine.exec import ExecutionConfig

# BAD
from engine.exec._base import ExecutionConfig
```

The `__init__.py` is the public API. Import from it.

### 7.3 — Lazy imports only for heavy/optional dependencies

If a dependency is heavy or only needed in a specific code path, import it inside the function:

```python
def forward(self, *args, **kwargs):
    from composio import Composio          # heavy, only needed here
    from composio_langchain import LangchainProvider
    ...
```

Otherwise include it at the top of the file. Do not import the same package multiple times in the
same file unless it is heavy and in a branch unlikely to be reached.

---

## 8. Error Handling

### 8.1 — Custom exception hierarchy

Define domain exceptions in a central `exceptions` module and inherit from appropriate bases:

```python
class AppInternalError(Exception):
    """Base for internal application errors."""
    pass

class LLMGenerationError(AppInternalError):
    """LLM generation failed."""
    pass

class ServiceCrashError(AppInternalError):
    """An external service crashed unexpectedly."""
    pass
```

### 8.2 — Never swallow exceptions silently

Log errors before re-raising or returning fallback values:

```python
except Exception as e:
    logger.error(f"Failed to provision kernel: {str(e)}")
    raise KernelResourceError(...) from e
```

---

## 9. Patterns to Avoid (Anti-patterns)

### 9.1 — Standalone functions where a class hierarchy exists

**BAD**: Writing `def execute_task(config, task):` as a standalone function when
`ProviderFactory.make()` already defines the contract.

**GOOD**: Create a new class inheriting from `ProviderFactory` and implement `make()`.

### 9.2 — Horizontal file splitting

**BAD**:
```
templates/notification_templates.py
configs/notification_config.py
services/notification_service.py
```

**GOOD**:
```
notifications/_service.py
notifications/_templates.py
notifications/_channels.py
```

### 9.3 — Untyped dictionaries

**BAD**: `def get_config() -> dict` — what's in the dict?

**GOOD**: `def get_config() -> SessionConfig` or `-> SomeTypedDict`

### 9.4 — God files / God classes

If a file is > 1000 lines and contains multiple unrelated concepts, split it. But don't over-split
either — keep related concepts together.

### 9.5 — Importing from private modules externally

**BAD**: `from engine.exec._base import ExecutionConfig`

**GOOD**: `from engine.exec import ExecutionConfig`

### 9.6 — Missing `__all__` in `__init__.py`

Every `__init__.py` that re-exports symbols must have an `__all__` list.

### 9.7 — Duplicate or near-duplicate code

If you find yourself copying a pattern from another file, it probably belongs in a base class
or utility. Extract it.

### 9.8 — Ignoring the dependency direction

Never have a lower-level module import from a higher-level one. If you need something
from a higher layer in a lower one, define an abstraction (base class or Protocol) in the lower
layer and implement it in the higher one.

### 9.9 — Raw `print()` instead of logging

Use the module's logger:

```python
import logging
log = logging.getLogger(__name__)
log.info("...")
log.error("...", exc_info=True)
```

Not `print(">>>>" + something)` (except for temporary debugging that never ships).

### 9.10 — Deep nesting instead of guard clauses

Prefer returning early over deeply nested `if/else` blocks:

```python
# BAD — pyramids of doom
def process_order(order: TOrder | None) -> Result:
  if order is not None:
    if order.status == "valid":
      if order.items:
        return handle(order)
      else:
        return Error("no items")
    else:
      return Error("invalid")
  else:
    return Error("no order")

# GOOD — guard clauses, then the happy path
def process_order(order: TOrder | None) -> Result:
  if order is None:
    return Error("no order")
  if order.status != "valid":
    return Error("invalid")
  if not order.items:
    return Error("no items")
  return handle(order)
```

Exit on failure at the top; the main logic flows unindented at the bottom.

### 9.11 — Mutable default arguments

Never use a mutable value (`list`, `dict`, `set`) as a default argument — it's shared across
all calls. Use `None` and create inside the function, or `field(default_factory=list)` /
`Field(default_factory=list)` in dataclasses/Pydantic.

---

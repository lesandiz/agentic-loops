# <Feature Title>

> Replace all `<placeholders>` and example content. Delete this callout when done.

## Context

<!-- 2-3 sentences: what problem this solves and why it matters now. -->

## Design Decisions

<!-- Numbered decisions the agent MUST follow. Agent cannot deviate without escalation. -->

- **DD-1**: <decision> — <rationale>
- **DD-2**: <decision> — <rationale>

## Scope

### In Scope

- <what this feature covers>

### Out of Scope

- <what is explicitly excluded and why>

---

## Phase 1: <Title>

**Goal:** <One sentence describing the deliverable.>

### Changes

| Action | File                      | Change                           |
| ------ | ------------------------- | -------------------------------- |
| Create | `src/Path/To/NewFile.cs`  | Implement `IFoo`                 |
| Modify | `src/Path/To/Existing.cs` | Add `IFoo` constructor parameter |
| Delete | `src/Path/To/Legacy.cs`   | Replaced by `NewFile.cs`         |

### Code

<!-- Copy-paste-ready snippets for non-trivial implementations. -->
<!-- Agent should treat these as the baseline — adapt to context but preserve intent. -->

```csharp
public class Foo : IFoo
{
    public Foo(IBar bar)
    {
        _bar = bar;
    }
}
```

### Acceptance Criteria

<!-- Binary pass/fail. Agent checks these after completing all tasks in this phase. -->

- [ ] `IFoo` is injected via constructor, not resolved via service locator
- [ ] Existing tests pass: `dotnet test src/UD.Tests.Foo`
- [ ] No warnings introduced: `dotnet build src/UD.Foo`

### Test Cases

<!-- Tests are grouped by the change they verify. Each test ships with its corresponding change, -->
<!-- not as a separate task. The "Covers" column maps to a row in the Changes table above. -->

| Test Project   | Test Class | Method                            | Asserts                                        | Covers       |
| -------------- | ---------- | --------------------------------- | ---------------------------------------------- | ------------ |
| `UD.Tests.Foo` | `FooTests` | `Bar_WhenValid_ReturnsExpected`   | `result.Should().Be(expected)`                 | `NewFile.cs`  |
| `UD.Tests.Foo` | `FooTests` | `Bar_WhenNull_ThrowsArgumentNull` | `Should().ThrowAsync<ArgumentNullException>()` | `NewFile.cs`  |

### Verification

<!-- Commands the agent MUST run before marking this phase complete. -->

```bash
dotnet build src/UD.Foo
dotnet test src/UD.Tests.Foo
```

---

## Phase 2: <Title>

**Goal:** <One sentence.>

### Changes

| Action | File | Change |
| ------ | ---- | ------ |

### Code

```csharp
// Key implementation patterns
```

### Acceptance Criteria

- [ ] <criterion>

### Test Cases

| Test Project | Test Class | Method | Asserts | Covers |
| ------------ | ---------- | ------ | ------- | ------ |

### Verification

```bash
dotnet build src/UD.Foo
dotnet test src/UD.Tests.Foo
```

---

<!-- Repeat phase sections as needed. -->
<!--
## When to split this file

Split into numbered specs (specs/01-<component>.md, etc.) when phases are INDEPENDENT
— i.e. they touch unrelated components and don't build on each other.
This lets the agent load only the relevant spec per phase, reducing context and confusion.

Keep a single SPEC.md when phases are SEQUENTIAL / CUMULATIVE
— i.e. each phase builds on the previous one and the agent needs prior phase context.

See README.md § Scaling Rules for full guidance.

Each numbered spec MUST be self-contained: own Changes, Acceptance Criteria, Test Cases, Verification.
-->

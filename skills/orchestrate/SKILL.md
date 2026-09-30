---
name: orchestrate
description: Use when the runtime can run background agents and there is research, planning, code work across several files, or a status or summary sweep to do — never for the routine journal, task, capture, people or learned writes, which stay inline. Also when a piece of work is handed to another agent, session or model: deciding where it goes and at what effort, writing the brief, checking what comes back, or carrying out a written plan.
---

# Orchestrating the work

Work that is bigger than one session is placed, briefed, checked and reported. What follows
is where a piece of work goes, how it is asked for, how what comes back is treated, and the
few rules of character that hold whatever the work is.

Only where the runtime can actually open background agents. Where it cannot, all of it
collapses to: plan it, do it in order, report once.

## Placing the work

Four effort tiers, named by weight and never by product, because the runtime under them
changes:

| Tier | The work |
|---|---|
| **extreme** | Irreversible, or wrong is expensive: an architecture call, a live system, money, a security boundary. |
| **heavy** | Real reasoning over real material: a plan, a review, research that has to be believed. |
| **medium** | Bounded and mechanical but still needs judgement: a bug fix with a test, a focused edit across a few files. |
| **simple** | Fetch, count, format, rename, re-run. |

A tier asks for at most what has been selected for this session: the selected model is the ceiling,
never a reach for something better. Where the selected runtime sits below the tier the work
needs, say so and let the owner decide; do not quietly do extreme work at a simple tier and
hand back the result as if it were the same thing.

Where the runtime exposes a model list, the tier picks from it. Where it does not, the tier
is a statement about care: how much verification the result gets before it is believed.

**A quota running out is a placement problem, not a reason to stop.** Move the work to
another tier or another runtime and say which, in one line.

**A handed-off task carries its tier in its title.** The short title it appears under begins
with the tier it was actually placed at — `Heavy:`, `Medium:`, `Simple:`, or the model name
where the runtime writes one there itself. Whoever is watching a list of running work should
read the weight off it at a glance, without opening anything.

## Briefing

A brief is four things and nothing else: the job, the rules it must not break, how it will
be verified, and the exact shape of the report it must return. A worker that has to guess
any of the four returns something that has to be redone.

- One deliverable per brief. Two deliverables is two briefs.
- Name the files it may write and the folders it may not touch. A worker that edits outside
  its brief has done damage, not work.
- Workers run in the background by default, so the owner can keep talking; check each result
  when it returns. The template carries the no-further-delegation line, so a worker that never
  loaded this skill still knows it.
- Resume a worker that has already finished rather than briefing a fresh one from scratch:
  it still holds the context you would have to re-explain.

The template a brief is written from:

```
Job: <the one deliverable>
Rules: <what it must not break; the files it may write, the folders it may not touch>
  You are a worker: do not delegate further.
Verified by: <the command or check that proves it>
Report: <the exact shape of what comes back>
```

## Checking what comes back

What comes back is **a report, not a fact**. Check a claim against the thing itself before
building on it — especially a number, and especially a number that is convenient.

Read the removed lines in a delivered diff before the added ones. A worker told to add a
section overwrites the end of a page while adding it, and the loss is invisible in the added
text.

## One report per wave

Findings scattered through a conversation cannot be followed by anyone. Each round of work ends
in **one document that can be read top to bottom**, a new one each time. The conversation carries
its conclusion in two or three lines plus the link, never the link alone.

- **An artifact where the runtime can publish one. Otherwise a PDF. Otherwise a plain,
  self-contained HTML file.** The template and the rule it carries: `.brand/report.html`.
- The conclusion first, in a sentence or two per topic, then the numbers under it.
- Short sentences. Numbers, not claims. No narration of who did what, no repetition, no
  hedging.
- Written for the owner, in their language: no file paths, no line numbers, no config keys,
  no tool names in the body. A short "source documents" appendix at the end if needed.
- It carries the logo and the brand. It is not boring and it is not long.

## One voice

The assistant speaks to the owner as one voice. How the work gets done is not something the owner
is asked to follow.

- The assistant says "noted", in the owner's language, not "I am passing this to the coder". It does not
  narrate handoffs, name what is running behind it, or report that something has been queued.
  It says what will happen and when, in the first person, and owns the result.
- **Honesty is preserved.** Asked how it works, it answers plainly:
  other agents may work behind it, like a small agency. It never denies that.
- **On a platform or a paid product**, keep to the surface: the customer bought the result, not the
  method.
- **Not a rule about the owner.** An owner watching their own agents in their own interface
  is watching their own work, and keeps doing so.

## A question goes to the person it belongs to

A worker's question goes to the person whose subject it is (the owner's work to the owner, the
machine and accounts to whoever maintains the workspace), never to whoever is nearest.

## Carrying out a plan

- A plan is an argument, not a script. When a step's instruction does not match what the
  files actually contain, **stop at that step and say so** — the plan is now wrong about
  something, and finishing the step anyway writes the mistake into the code.
- One task, one test cycle, one commit. A task that cannot be verified on its own was drawn
  too wide.
- No step is skipped silently. A step that turns out to be unnecessary is reported as
  unnecessary, with the reason.
- The plan is amended by whoever owns it. Whoever executes it does not edit it to match what
  they did.

## When not to run this at all

A single small edit whose shape is clear gets done directly.
Handing it out costs more than it saves, and the owner pays for the ceremony.

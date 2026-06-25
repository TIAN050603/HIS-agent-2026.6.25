# Voice Task Equivalence Report

Generated at: 2026-06-25T09:48:46.935Z
Run ID: voice-task-equivalence-20260625T094846Z

## Summary

- Voice pipeline entry: executePendingVoiceTask -> handleCommand(..., voice_confirmed_task)
- Typed task pipeline entry: handleCommand -> AgentTaskOrchestrator.startTask
- Static equivalence status: static_equivalence_passed
- Live LLM equivalence validated: false

## Checks

- voice_review_generates_editable_task: true
- voice_confirmed_task_calls_common_handler: true
- common_handler_calls_agent_task_orchestrator: true
- voice_draft_does_not_directly_execute: true

## Boundary

- Voice session task drafting only produces editable natural-language task text.
- After doctor confirmation, the edited text is passed through the normal Agent taskflow and backend planner.
- This report is static unless combined with RUN_LLM_E2E browser execution.


# -*- coding: utf-8 -*-
import asyncio
import contextvars
import functools
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


BACKEND_DIR = Path(__file__).resolve().parent
ALLOWED_TARGET_URL = "https://tian050603.github.io/gui-agent-patient-editor-test/"
UTF8_JSON = "application/json; charset=utf-8"
DEFAULT_DIARIZATION_INTERNAL_URL = "http://127.0.0.1:8020"

DEFAULT_CORS_ALLOWED_ORIGINS = [
    "null",
    "https://tian050603.github.io",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://10.26.6.8:31451",
    "http://10.26.6.8:31169",
    "http://10.26.6.8:30197",
    "http://10.26.6.8:31034",
]

DEFAULT_CORS_ALLOW_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|10\.26\.6\.8):[0-9]+$"


def parse_cors_allowed_origins(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def get_cors_allowed_origins() -> list[str]:
    configured = parse_cors_allowed_origins(os.getenv("CORS_ALLOWED_ORIGINS"))
    seen: set[str] = set()
    result: list[str] = []
    for origin in configured + DEFAULT_CORS_ALLOWED_ORIGINS:
        if origin in seen:
            continue
        seen.add(origin)
        result.append(origin)
    return result


def get_cors_allow_origin_regex() -> str | None:
    value = os.getenv("CORS_ALLOW_ORIGIN_REGEX", DEFAULT_CORS_ALLOW_ORIGIN_REGEX).strip()
    return value or None

FIELD_SCHEMA: dict[str, dict[str, Any]] = {
    "name": {"label": "姓名", "selectors": ["#nameInput", '[data-testid="name-input"]', 'input[name="name"]', '[aria-label="姓名"]'], "kind": "text"},
    "gender": {"label": "性别", "selectors": ["#genderSelect", '[data-testid="gender-select"]', 'select[name="gender"]', '[aria-label="性别"]'], "kind": "select", "options": ["男", "女", "其他"]},
    "age": {"label": "年龄", "selectors": ["#ageInput", '[data-testid="age-input"]', 'input[name="age"]', '[aria-label="年龄"]'], "kind": "text"},
    "birthDate": {"label": "出生日期", "selectors": ["#birthDateInput", '[data-testid="birth-date-input"]', 'input[name="birthDate"]', '[aria-label="出生日期"]'], "kind": "text"},
    "phone": {"label": "手机号", "selectors": ["#phoneInput", '[data-testid="phone-input"]', 'input[name="phone"]', '[aria-label="手机号"]'], "kind": "text"},
    "idType": {"label": "证件类型", "selectors": ["#idTypeSelect", '[data-testid="id-type-select"]', 'select[name="idType"]', '[aria-label="证件类型"]'], "kind": "select", "options": ["身份证", "护照", "港澳通行证", "其他"]},
    "idNumber": {"label": "证件号码", "selectors": ["#idNumberInput", '[data-testid="id-number-input"]', 'input[name="idNumber"]', '[aria-label="证件号码"]'], "kind": "text"},
    "address": {"label": "地址", "selectors": ["#addressInput", '[data-testid="address-input"]', 'input[name="address"]', '[aria-label="地址"]'], "kind": "text"},
    "emergencyContact": {"label": "紧急联系人", "selectors": ["#emergencyContactInput", '[data-testid="emergency-contact-input"]', 'input[name="emergencyContact"]', '[aria-label="紧急联系人"]'], "kind": "text"},
    "emergencyPhone": {"label": "紧急联系人电话", "selectors": ["#emergencyPhoneInput", '[data-testid="emergency-phone-input"]', 'input[name="emergencyPhone"]', '[aria-label="紧急联系人电话"]'], "kind": "text"},
    "department": {"label": "就诊科室", "selectors": ["#departmentSelect", '[data-testid="department-select"]', 'select[name="department"]', '[aria-label="就诊科室"]'], "kind": "select", "options": ["呼吸内科", "消化内科", "心血管内科", "神经内科", "骨科", "皮肤科", "儿科", "眼科", "耳鼻喉科", "急诊科"]},
    "visitType": {"label": "就诊类型", "selectors": ['input[name="visitType"]'], "kind": "radio", "options": ["初诊", "复诊", "急诊"]},
    "insuranceType": {"label": "医保类型", "selectors": ["#insuranceTypeSelect", '[data-testid="insurance-type-select"]', 'select[name="insuranceType"]', '[aria-label="医保类型"]'], "kind": "select", "options": ["城镇职工医保", "城乡居民医保", "商业保险", "自费", "其他"]},
    "hasAllergy": {"label": "是否有过敏史", "selectors": ["#hasAllergyCheckbox", '[data-testid="has-allergy-checkbox"]', 'input[name="hasAllergy"]', '[aria-label="是否有过敏史"]'], "kind": "checkbox"},
    "allergyNote": {"label": "过敏史说明", "selectors": ["#allergyNoteTextarea", '[data-testid="allergy-note-textarea"]', 'textarea[name="allergyNote"]', '[aria-label="过敏史说明"]'], "kind": "text"},
    "medicalHistory": {"label": "既往病史", "selectors": ["#medicalHistoryTextarea", '[data-testid="medical-history-textarea"]', 'textarea[name="medicalHistory"]', '[aria-label="既往病史"]'], "kind": "text"},
    "symptoms": {"label": "主诉/症状描述", "selectors": ["#symptomsTextarea", '[data-testid="symptoms-textarea"]', 'textarea[name="symptoms"]', '[aria-label="主诉/症状描述"]'], "kind": "text"},
    "remark": {"label": "备注", "selectors": ["#remarkTextarea", '[data-testid="remark-textarea"]', 'textarea[name="remark"]', '[aria-label="备注"]'], "kind": "text"},
}

FIELD_SCHEMA.update({
    "chiefComplaint": {"label": "主诉", "selectors": ['[data-field="chiefComplaint"]', "#chiefComplaintInput"], "kind": "text"},
    "presentIllness": {"label": "现病史", "selectors": ['[data-field="presentIllness"]', "#presentIllnessInput"], "kind": "text"},
    "pastHistory": {"label": "既往史", "selectors": ['[data-field="pastHistory"]', "#pastHistoryInput"], "kind": "text"},
    "allergyHistory": {"label": "过敏史", "selectors": ['[data-field="allergyHistory"]', "#allergyHistoryInput"], "kind": "text"},
    "vitalSigns": {"label": "生命体征", "selectors": ['[data-field="vitalSigns"]', "#vitalSignsInput"], "kind": "text"},
    "diagnosis": {"label": "诊断", "selectors": ['[data-field="diagnosis"]', "#diagnosisInput"], "kind": "text"},
    "examSummary": {"label": "检查检验", "selectors": ['[data-field="examSummary"]', "#examSummaryInput"], "kind": "text"},
    "orders": {"label": "医嘱/处方", "selectors": ['[data-field="orders"]', "#ordersInput"], "kind": "text"},
    "note": {"label": "备注", "selectors": ['[data-field="note"]', "#noteInput"], "kind": "text"},
})

SELECTOR_TO_FIELD = {
    "#nameInput": "name",
    "#genderSelect": "gender",
    "#ageInput": "age",
    "#birthDateInput": "birthDate",
    "#phoneInput": "phone",
    "#idTypeSelect": "idType",
    "#idNumberInput": "idNumber",
    "#addressInput": "address",
    "#emergencyContactInput": "emergencyContact",
    "#emergencyPhoneInput": "emergencyPhone",
    "#departmentSelect": "department",
    "#insuranceTypeSelect": "insuranceType",
    "#hasAllergyCheckbox": "hasAllergy",
    "#allergyNoteTextarea": "allergyNote",
    "#medicalHistoryTextarea": "medicalHistory",
    "#symptomsTextarea": "symptoms",
    "#remarkTextarea": "remark",
}

PATIENT_NAME_TO_ID = {
    "张伟": "P001",
    "李娜": "P002",
    "王强": "P003",
    "陈敏": "P004",
    "赵磊": "P005",
}

EDITABLE_FIELDS = set(FIELD_SCHEMA.keys())
INTERNAL_PAGES = {"login", "dashboard", "patientManagement", "patientEditor"}
ALLOWED_HARNESS_ACTIONS = {
    "fill_input",
    "fill_login_form",
    "submit_login",
    "logout",
    "open_page",
    "navigate_internal",
    "find_patient",
    "select_patient",
    "open_patient_editor",
    "update_patient_field",
    "update_patient_fields",
    "verify_patient_field",
    "verify_patient_store",
    "save_patient",
    "create_structured_draft",
    "write_clinical_note_field",
    "ask_clarification",
    "finish_task",
    "cancel_task",
    "noop",
}
FIELD_ONTOLOGY = {
    "birthDate": ["出生日期", "生日", "birth date", "birthDate"],
    "gender": ["性别"],
    "phone": ["手机号", "电话", "联系电话", "手机"],
    "department": ["科室", "就诊科室", "门诊科室"],
    "address": ["地址", "住址"],
    "emergencyContact": ["紧急联系人"],
    "emergencyPhone": ["紧急联系人电话", "紧急电话"],
    "symptoms": ["主诉", "chiefComplaint", "症状", "当前症状"],
    "allergyNote": ["过敏史", "allergyHistory", "过敏说明"],
    "medicalHistory": ["既往史", "病史", "既往病史"],
    "remark": ["备注"],
}

load_dotenv(BACKEND_DIR / ".env")

app = FastAPI(title="Universal Agent Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_allowed_origins(),
    allow_origin_regex=get_cors_allow_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_diarization_internal_url() -> str:
    return os.getenv("DIARIZATION_INTERNAL_URL", DEFAULT_DIARIZATION_INTERNAL_URL).strip().rstrip("/")


def diarization_ws_url() -> str:
    base = get_diarization_internal_url()
    if base.startswith("https://"):
        return "wss://" + base[len("https://"):] + "/ws/diarization"
    if base.startswith("http://"):
        return "ws://" + base[len("http://"):] + "/ws/diarization"
    return base.rstrip("/") + "/ws/diarization"


def proxy_diarization_health() -> JSONResponse:
    url = get_diarization_internal_url() + "/diarization/health"
    try:
        response = requests.get(url, timeout=3)
        try:
            payload = response.json()
        except Exception:
            payload = {"ok": False, "service": "diarization_service", "provider": "manual", "status": "error", "message": response.text[:300]}
        payload["proxy"] = "backend"
        payload["proxy_url"] = url
        return JSONResponse(payload, status_code=response.status_code, media_type=UTF8_JSON)
    except Exception as exc:
        return JSONResponse(
            {
                "ok": False,
                "service": "diarization_service",
                "provider": "manual",
                "status": "disconnected",
                "active_provider": "manual",
                "proxy": "backend",
                "proxy_url": url,
                "message": f"diarization_service unreachable: {type(exc).__name__}: {exc}",
            },
            status_code=200,
            media_type=UTF8_JSON,
        )


@app.get("/api/diarization/health", response_model=None)
def api_diarization_health() -> JSONResponse:
    return proxy_diarization_health()


@app.get("/diarization/health", response_model=None)
def public_diarization_health() -> JSONResponse:
    return proxy_diarization_health()


@app.websocket("/ws/diarization")
async def diarization_websocket_proxy(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        import websockets

        async with websockets.connect(diarization_ws_url(), max_size=8 * 1024 * 1024) as upstream:
            async def browser_to_service() -> None:
                while True:
                    message = await websocket.receive()
                    if message.get("text") is not None:
                        await upstream.send(message["text"])
                    elif message.get("bytes") is not None:
                        await upstream.send(message["bytes"])

            async def service_to_browser() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            tasks = [asyncio.create_task(browser_to_service()), asyncio.create_task(service_to_browser())]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": f"diarization proxy failed: {type(exc).__name__}: {exc}"})
        except Exception:
            pass



# -----------------------------------------------------------------------------
# Timing / Profiling helpers
# -----------------------------------------------------------------------------

_TRACE_ID: contextvars.ContextVar[str] = contextvars.ContextVar("trace_id", default="-")
_TRACE_DEPTH: contextvars.ContextVar[int] = contextvars.ContextVar("trace_depth", default=0)


def _new_trace_id() -> str:
    # Short request-level id for correlating timing logs belonging to the same request.
    return str(time.time_ns())[-9:]


def _timer_indent() -> str:
    return "  " * max(0, _TRACE_DEPTH.get())


def log_timer(message: str) -> None:
    print(f"[TIMER][trace={_TRACE_ID.get()}] {_timer_indent()}{message}", flush=True)


class timed_block:
    """Context manager for measuring a specific operation inside a function."""

    def __init__(self, name: str, **extra: Any) -> None:
        self.name = name
        self.extra = extra
        self.started_at = 0.0
        self.depth_token = None

    def __enter__(self) -> "timed_block":
        extra_text = " ".join(f"{key}={value}" for key, value in self.extra.items())
        log_timer(f"START block:{self.name}" + (f" {extra_text}" if extra_text else ""))
        self.started_at = time.perf_counter()
        self.depth_token = _TRACE_DEPTH.set(_TRACE_DEPTH.get() + 1)
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        elapsed_ms = (time.perf_counter() - self.started_at) * 1000
        if self.depth_token is not None:
            _TRACE_DEPTH.reset(self.depth_token)
        status = "ERROR" if exc_type else "END"
        log_timer(f"{status} block:{self.name} elapsed_ms={elapsed_ms:.3f}")
        return False


def timed(name: str | None = None):
    """Decorator for measuring a whole sync or async function."""

    def decorator(func):
        timer_name = name or func.__name__

        if getattr(func, "__code__", None) and bool(func.__code__.co_flags & 0x80):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                trace_token = None
                if _TRACE_ID.get() == "-":
                    trace_token = _TRACE_ID.set(_new_trace_id())
                log_timer(f"START func:{timer_name}")
                started_at = time.perf_counter()
                depth_token = _TRACE_DEPTH.set(_TRACE_DEPTH.get() + 1)
                try:
                    return await func(*args, **kwargs)
                except Exception:
                    elapsed_ms = (time.perf_counter() - started_at) * 1000
                    try:
                        _TRACE_DEPTH.reset(depth_token)
                    except Exception:
                        pass
                    log_timer(f"ERROR func:{timer_name} elapsed_ms={elapsed_ms:.3f}")
                    raise
                finally:
                    try:
                        _TRACE_DEPTH.reset(depth_token)
                    except Exception:
                        pass
                    elapsed_ms = (time.perf_counter() - started_at) * 1000
                    log_timer(f"END func:{timer_name} elapsed_ms={elapsed_ms:.3f}")
                    if trace_token is not None:
                        _TRACE_ID.reset(trace_token)

            return async_wrapper

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            trace_token = None
            if _TRACE_ID.get() == "-":
                trace_token = _TRACE_ID.set(_new_trace_id())
            log_timer(f"START func:{timer_name}")
            started_at = time.perf_counter()
            depth_token = _TRACE_DEPTH.set(_TRACE_DEPTH.get() + 1)
            try:
                return func(*args, **kwargs)
            except Exception:
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                try:
                    _TRACE_DEPTH.reset(depth_token)
                except Exception:
                    pass
                log_timer(f"ERROR func:{timer_name} elapsed_ms={elapsed_ms:.3f}")
                raise
            finally:
                try:
                    _TRACE_DEPTH.reset(depth_token)
                except Exception:
                    pass
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                log_timer(f"END func:{timer_name} elapsed_ms={elapsed_ms:.3f}")
                if trace_token is not None:
                    _TRACE_ID.reset(trace_token)

        return sync_wrapper

    return decorator

class AgentRunRequest(BaseModel):
    command: str = Field(..., description="用户输入的自然语言任务")
    targetUrl: str = Field(..., description="允许 访问的目标页面 URL")
    elapsedMs: int = Field(0, description="从用户发送指令开始经过的毫秒数")


class UniversalNextActionRequest(BaseModel):
    command: str = Field(..., description="用户原始中文自然语言任务")
    stepIndex: int = Field(0, description="当前 observe-act 步数，从 0 开始")
    maxSteps: int = Field(10, description="最大执行步数")
    elapsedMs: int = Field(0, description="从用户发送指令开始经过的毫秒数")
    pageState: dict[str, Any] = Field(default_factory=dict, description="前端采集的当前页面结构化状态")
    history: list[dict[str, Any]] = Field(default_factory=list, description="之前 action 与执行结果历史")
    conversationTurns: list[dict[str, Any]] = Field(default_factory=list, description="ASR 结构化医生/患者对话 turns")
    agentMessages: list[dict[str, Any]] = Field(default_factory=list, description="悬浮 Agent 历史消息")


class TaskStep(BaseModel):
    id: str = ""
    goal: str = ""
    requiredPage: str = ""
    actionType: str = ""
    args: dict[str, Any] = Field(default_factory=dict)
    status: str = "pending"
    result: dict[str, Any] | None = None
    error: str | None = None


class AgentTask(BaseModel):
    task_id: str = ""
    objective: str = ""
    status: str = "running"
    slots: dict[str, Any] = Field(default_factory=dict)
    plan: list[TaskStep] = Field(default_factory=list)
    current_step_index: int = 0
    created_at: float = 0
    updated_at: float = 0


class AgentAction(BaseModel):
    type: str
    args: dict[str, Any] = Field(default_factory=dict)
    expected_result: dict[str, Any] = Field(default_factory=dict)
    continue_after_navigation: bool = False


class ClarificationRequest(BaseModel):
    question: str
    options: list[str] = Field(default_factory=list)
    reason: str = ""


class ActionResult(BaseModel):
    success: bool = False
    action_type: str = ""
    page_before: str = ""
    page_after: str = ""
    changed_fields: list[str] = Field(default_factory=list)
    navigation_happened: bool = False
    error: str = ""
    observation: str = ""


class AgentResponse(BaseModel):
    kind: str
    message: str = ""
    task: AgentTask | None = None
    action: AgentAction | None = None
    clarification: ClarificationRequest | None = None
    confidence: float = 0
    errors: list[str] = Field(default_factory=list)


class TaskPlannerRequest(BaseModel):
    user_message: str
    page_state: dict[str, Any] = Field(default_factory=dict)
    active_task: dict[str, Any] = Field(default_factory=dict)
    conversation_history: list[dict[str, Any]] = Field(default_factory=list)
    patient_store_summary: list[dict[str, Any]] = Field(default_factory=list)
    full_patient_index: list[dict[str, Any]] = Field(default_factory=list)
    speaker_turns: list[dict[str, Any]] = Field(default_factory=list)
    task_origin: str = ""
    input_route: dict[str, Any] = Field(default_factory=dict)
    task_contract: dict[str, Any] = Field(default_factory=dict)


class NextStepRequest(BaseModel):
    active_task: dict[str, Any]
    page_state: dict[str, Any] = Field(default_factory=dict)
    last_action_result: dict[str, Any] = Field(default_factory=dict)
    patient_store_summary: list[dict[str, Any]] = Field(default_factory=list)
    full_patient_index: list[dict[str, Any]] = Field(default_factory=list)


class RepairRequest(BaseModel):
    active_task: dict[str, Any]
    page_state: dict[str, Any] = Field(default_factory=dict)
    failed_action: dict[str, Any] = Field(default_factory=dict)
    action_result: dict[str, Any] = Field(default_factory=dict)
    patient_store_summary: list[dict[str, Any]] = Field(default_factory=list)
    full_patient_index: list[dict[str, Any]] = Field(default_factory=list)


class VoiceTurnsToAgentTaskRequest(BaseModel):
    patient_context: dict[str, Any] = Field(default_factory=dict)
    turns: list[dict[str, Any]] = Field(default_factory=list)
    current_page_type: str = ""
    current_patient_id: str = ""


class Utf8JSONResponse(JSONResponse):
    media_type = UTF8_JSON

    def render(self, content: Any) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")


@timed("utf8_json")
def utf8_json(content: dict[str, Any], status_code: int = 200) -> JSONResponse:
    return Utf8JSONResponse(status_code=status_code, content=content)


@timed("format_elapsed_time")
def format_elapsed_time(elapsed_ms: int) -> str:
    total_seconds = max(0, int(elapsed_ms or 0) // 1000)
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    return f"{minutes:02d}:{seconds:02d}"



@timed("remove_qwen_think_blocks")
def remove_qwen_think_blocks(text: str) -> str:
    cleaned = (text or "").strip()
    while True:
        start = cleaned.find("<think>")
        if start < 0:
            break
        end = cleaned.find("</think>", start)
        if end < 0:
            cleaned = cleaned[:start].strip()
            break
        cleaned = (cleaned[:start] + cleaned[end + len("</think>"):]).strip()
    return cleaned


@timed("extract_json_object_text")
def extract_json_object_text(text: str) -> str:
    cleaned = remove_qwen_think_blocks(text)
    if not cleaned:
        return cleaned
    try:
        json.loads(cleaned)
        return cleaned
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    if start < 0:
        return cleaned

    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(cleaned)):
        char = cleaned[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                candidate = cleaned[start:index + 1].strip()
                try:
                    json.loads(candidate)
                    return candidate
                except json.JSONDecodeError:
                    return cleaned
    return cleaned


@timed("parse_qwen_json_content")
def parse_qwen_json_content(content: str) -> tuple[dict[str, Any], str]:
    candidate = extract_json_object_text(content or "")
    return json.loads(candidate), candidate

@timed("normalize_target_url")
def normalize_target_url(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    return url if url.endswith("/") else url + "/"



@timed("get_dashscope_base_url")
def get_dashscope_base_url() -> str:
    return (
        os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()
        or "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )


@timed("get_dashscope_model")
def get_dashscope_model() -> str:
    return os.getenv("DASHSCOPE_MODEL", "qwen-plus").strip() or "qwen-plus"


@timed("get_llm_provider")
def get_llm_provider() -> str:
    provider = (os.getenv("LLM_PROVIDER") or "qwen").strip().lower()
    return provider or "qwen"


@timed("get_llm_api_key")
def get_llm_api_key() -> str:
    return (
        os.getenv("LLM_API_KEY")
        or os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or ""
    ).strip()


@timed("get_llm_base_url")
def get_llm_base_url() -> str:
    provider = get_llm_provider()
    default_url = "https://api.openai.com/v1" if provider == "openai" else "https://dashscope.aliyuncs.com/compatible-mode/v1"
    return (
        os.getenv("LLM_BASE_URL")
        or os.getenv("DASHSCOPE_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or default_url
    ).strip() or default_url


@timed("get_llm_model")
def get_llm_model() -> str:
    return (
        os.getenv("LLM_MODEL")
        or os.getenv("DASHSCOPE_MODEL")
        or os.getenv("OPENAI_MODEL")
        or ("gpt-4o" if get_llm_provider() == "openai" else "qwen-plus")
    ).strip()


def build_chat_completion_payload(messages: list[dict[str, str]], max_tokens: int) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": get_llm_model(),
        "messages": messages,
        "temperature": 0,
        "max_tokens": max_tokens,
    }
    if get_llm_provider() in {"qwen", "dashscope"}:
        payload["enable_thinking"] = False
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    return payload


def get_llm_status_test_timeout() -> float:
    try:
        value = float(os.getenv("LLM_STATUS_TEST_TIMEOUT_SECONDS", "10"))
    except ValueError:
        value = 10.0
    return max(1.0, min(value, 10.0))


@app.get("/api/health", response_model=None)
@timed("endpoint:health")
async def health():
    return utf8_json({"ok": True, "message": "Universal Agent backend is running"})


@app.get("/api/llm/test", response_model=None)
@timed("endpoint:test_llm")
async def test_llm():
    api_key = get_llm_api_key()
    provider = get_llm_provider()
    if not api_key:
        return utf8_json({"ok": False, "error": "未配置 LLM_API_KEY / DASHSCOPE_API_KEY / OPENAI_API_KEY"}, 400)

    model = get_llm_model()
    base_url = get_llm_base_url().rstrip("/")
    url = base_url + "/chat/completions"

    timeout = get_llm_status_test_timeout()

    try:
        response = await asyncio.to_thread(
            requests.post,
            url,
            headers={
                "Authorization": "Bearer " + api_key,
                "Content-Type": "application/json",
            },
            json=build_chat_completion_payload([{"role": "user", "content": "只回复 ok"}], 4),
            timeout=timeout,
        )
        if response.status_code >= 400:
            return utf8_json(
                {
                    "ok": False,
                    "error": "LLM test failed: HTTP "
                    + str(response.status_code)
                    + " "
                    + response.text[:500],
                },
                response.status_code,
            )
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return utf8_json({"ok": True, "provider": provider, "model": model, "content": content})
    except requests.Timeout:
        return utf8_json({"ok": False, "error": "LLM test timeout after " + str(int(timeout)) + " seconds"}, 504)
    except Exception as exc:
        return utf8_json({"ok": False, "error": "LLM test failed: " + str(exc)}, 500)


@app.get("/api/qwen/test", response_model=None)
@timed("endpoint:test_qwen_compat")
async def test_qwen():
    return await test_llm()


@timed("build_plan_prompt")
def build_plan_prompt(command: str) -> list[dict[str, str]]:
    schema = {
        "patient": {"patientId": "P001", "name": "??"},
        "updates": {field: None for field in FIELD_SCHEMA},
        "save": True,
        "intent": "edit_patient",
        "confidence": 0.95,
    }
    system_prompt = (
        "你是一个医疗测试表单任务解析器。你只把用户中文任务解析成 JSON plan。"
        "只输出合法 JSON，不要输出 markdown，不要输出解释。"
        "字段只能使用给定 schema 中的 key。未修改字段必须为 null。"
        "save 只有在用户明确要求保存、提交、点击保存、然后保存时才为 true；用户说不要保存时必须为 false。"
        "可选值必须严格使用这些中文值："
        "gender=男/女/其他；idType=身份证/护照/港澳通行证/其他；"
        "department=呼吸内科/消化内科/心血管内科/神经内科/骨科/皮肤科/儿科/眼科/耳鼻喉科/急诊科；"
        "visitType=初诊/复诊/急诊；insuranceType=城镇职工医保/城乡居民医保/商业保险/自费/其他；"
        "hasAllergy=true/false。"
    )
    user_prompt = (
        "请解析这个任务：\n"
        + command
        + "\n\n严格输出这个 JSON schema，字段齐全，未修改字段填 null：\n"
        + json.dumps(schema, ensure_ascii=False, indent=2)
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


@timed("call_qwen_for_plan")
def call_qwen_for_plan(command: str) -> tuple[dict[str, Any] | None, str, str | None, dict[str, Any]]:
    llm_info = {
        "llmUsed": False,
        "provider": get_llm_provider(),
        "model": get_llm_model(),
        "usage": None,
    }
    api_key = get_llm_api_key()
    if not api_key:
        return None, "", "未配置 LLM_API_KEY / DASHSCOPE_API_KEY / OPENAI_API_KEY", llm_info

    url = get_llm_base_url().rstrip("/") + "/chat/completions"
    try:
        response = requests.post(
            url,
            headers={
                "Authorization": "Bearer " + api_key,
                "Content-Type": "application/json; charset=utf-8",
            },
            json=build_chat_completion_payload(build_plan_prompt(command), 512),
            timeout=30,
        )
        llm_info["llmUsed"] = True
    except requests.Timeout:
        return None, "", "LLM 解析任务超时", llm_info
    except Exception as exc:
        return None, "", "LLM 解析任务失败：" + str(exc), llm_info

    raw_body = response.text
    if response.status_code >= 400:
        return None, raw_body, "LLM 解析任务失败：HTTP " + str(response.status_code), llm_info

    try:
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage") or {}
        llm_info["usage"] = {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
    except Exception as exc:
        return None, raw_body, "LLM 返回不是合法响应 JSON：" + str(exc), llm_info

    raw_content = (content or "").strip()
    try:
        parsed_content, parsed_raw = parse_qwen_json_content(raw_content)
        return parsed_content, parsed_raw, None, llm_info
    except json.JSONDecodeError:
        return None, raw_content, "LLM 没有返回合法 JSON", llm_info



@timed("call_qwen_json")
def call_qwen_json(messages: list[dict[str, str]], purpose: str) -> tuple[dict[str, Any] | None, str, str | None, dict[str, Any]]:
    llm_info = {
        "llmUsed": False,
        "provider": get_llm_provider(),
        "model": get_llm_model(),
        "usage": None,
    }
    api_key = get_llm_api_key()
    if not api_key:
        return None, "", "LLM_API_KEY / DASHSCOPE_API_KEY / OPENAI_API_KEY is not configured", llm_info

    url = get_llm_base_url().rstrip("/") + "/chat/completions"
    try:
        response = requests.post(
            url,
            headers={
                "Authorization": "Bearer " + api_key,
                "Content-Type": "application/json; charset=utf-8",
            },
            json=build_chat_completion_payload(messages, 1200),
            timeout=45,
        )
        llm_info["llmUsed"] = True
    except requests.Timeout:
        return None, "", "LLM " + purpose + " timeout after 45 seconds", llm_info
    except Exception as exc:
        return None, "", "LLM " + purpose + " request failed: " + str(exc), llm_info

    raw_body = response.text
    if response.status_code >= 400:
        return None, raw_body, "LLM " + purpose + " failed: HTTP " + str(response.status_code), llm_info

    try:
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage") or {}
        llm_info["usage"] = {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
    except Exception as exc:
        return None, raw_body, "LLM " + purpose + " response was not valid JSON: " + str(exc), llm_info

    raw_content = (content or "").strip()
    try:
        parsed_content, parsed_raw = parse_qwen_json_content(raw_content)
        return parsed_content, parsed_raw, None, llm_info
    except json.JSONDecodeError:
        return None, raw_content, "LLM " + purpose + " did not return strict JSON", llm_info


@timed("call_qwen_text")
def call_qwen_text(messages: list[dict[str, str]], purpose: str, max_tokens: int = 220) -> tuple[str | None, str, str | None, dict[str, Any]]:
    llm_info = {
        "llmUsed": False,
        "provider": get_llm_provider(),
        "model": get_llm_model(),
        "usage": None,
    }
    api_key = get_llm_api_key()
    if not api_key:
        return None, "", "LLM_API_KEY / DASHSCOPE_API_KEY / OPENAI_API_KEY is not configured", llm_info

    url = get_llm_base_url().rstrip("/") + "/chat/completions"
    try:
        response = requests.post(
            url,
            headers={
                "Authorization": "Bearer " + api_key,
                "Content-Type": "application/json; charset=utf-8",
            },
            json=build_chat_completion_payload(messages, max_tokens),
            timeout=45,
        )
        llm_info["llmUsed"] = True
    except requests.Timeout:
        return None, "", "LLM " + purpose + " timeout after 45 seconds", llm_info
    except Exception as exc:
        return None, "", "LLM " + purpose + " request failed: " + str(exc), llm_info

    raw_body = response.text
    if response.status_code >= 400:
        return None, raw_body, "LLM " + purpose + " failed: HTTP " + str(response.status_code), llm_info

    try:
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage") or {}
        llm_info["usage"] = {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
    except Exception as exc:
        return None, raw_body, "LLM " + purpose + " response was not valid JSON: " + str(exc), llm_info

    return remove_qwen_think_blocks(str(content or "")).strip(), raw_body, None, llm_info


@timed("compact_conversation_turns")
def compact_conversation_turns(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for item in (turns or [])[-20:]:
        if not isinstance(item, dict):
            continue
        compact.append({
            "role": item.get("role"),
            "role_label": item.get("role_label"),
            "text": str(item.get("text") or "")[:240],
            "is_final": bool(item.get("is_final")),
            "source": item.get("source"),
        })
    return compact


NO_ACTION_VOICE_TASK_TEXT = "未发现明确需要执行的页面操作。可以选择生成病历草稿，或继续补充说明。"


@timed("compact_voice_task_turns")
def compact_voice_task_turns(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for item in (turns or [])[-30:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if role not in {"doctor", "patient"}:
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        compact.append({
            "role": role,
            "role_label": "医生" if role == "doctor" else "患者",
            "text": text[:500],
            "is_final": True,
        })
    return compact


@timed("compact_voice_patient_context")
def compact_voice_patient_context(payload: VoiceTurnsToAgentTaskRequest) -> dict[str, str]:
    context = payload.patient_context if isinstance(payload.patient_context, dict) else {}
    patient_id = str(payload.current_patient_id or context.get("patientId") or context.get("patient_id") or "").strip()
    patient_name = str(context.get("patientName") or context.get("patient_name") or context.get("name") or "").strip()
    page_type = str(payload.current_page_type or context.get("pageType") or context.get("page_type") or "").strip()
    return {
        "patientId": patient_id[:40],
        "patientName": patient_name[:80],
        "pageType": page_type[:60],
    }


@timed("build_voice_turns_to_agent_task_prompt")
def build_voice_turns_to_agent_task_prompt(payload: VoiceTurnsToAgentTaskRequest, turns: list[dict[str, Any]]) -> list[dict[str, str]]:
    context = compact_voice_patient_context(payload)
    patient_line = "未知患者"
    if context.get("patientId") or context.get("patientName"):
        patient_line = (context.get("patientId") + " " + context.get("patientName")).strip()
    dialogue = "\n".join(
        (item.get("role_label") or ("医生" if item.get("role") == "doctor" else "患者"))
        + "："
        + str(item.get("text") or "").strip()
        for item in turns
    )
    user_prompt = (
        "当前患者：\n"
        + patient_line
        + "\n\n当前页面：\n"
        + (context.get("pageType") or "未知页面")
        + "\n\n医生/患者对话：\n"
        + dialogue
        + "\n\n请判断并整理为一条待医生确认的自然语言任务。\n"
        "医生点击“结束对话并整理任务”本身表示：如果会话中有可记录的病历信息，或医生说“记录/写一下/保存/改为”，"
        "应整理成医生确认后可直接执行的 Agent 页面任务，而不是只生成草稿。\n"
        "只能返回一个 JSON 对象，字段为 result_type、task_text、proposed_fields、reason_summary。\n"
        "result_type 只能是 explicit_action、no_action、needs_clarification。\n"
        "explicit_action：医生明确要求修改页面字段、保存、记录病情、打开页面或执行页面操作；"
        "如果可从对话归纳主诉和现病史，task_text 应写成“请将患者 ... 的主诉更新为 ...，现病史更新为 ...，并保存。”\n"
        "no_action：只是寒暄、问诊但没有足够可整理内容。\n"
        "needs_clarification：内容不足以确定患者或任务，需要医生继续说明。\n"
        "task_text 必须是简短自然语言，不要包含页面 action JSON，不要自动保存。\n"
        "proposed_fields 必须是对象数组，每项包含 field、label、value，例如："
        '[{"field":"chiefComplaint","label":"主诉","value":"咳嗽两天伴低热"},'
        '{"field":"presentIllness","label":"现病史","value":"近两天咳嗽，少量白痰，夜间咳嗽更明显，伴低热"}]。\n'
        "主诉只写主要症状、持续时间和关键伴随症状；病程细节、夜间加重、痰量等写入 presentIllness。\n"
        "只能列出对话明确支持的字段；不要强行生成 pastHistory/既往史，除非对话中明确出现既往史内容。\n"
        "如果只有病情内容但无法确定要写入哪个字段，优先整理为写入当前患者备注并保存的任务；"
        "如果完全没有可执行或可记录内容，task_text 返回“未发现明确需要执行的页面操作”。"
    )
    system_prompt = (
        "你是就诊会话整理器，只生成待医生确认的自然语言任务。"
        "不要规划或返回页面 action，不要保存，不要修改 patient-store，不要写 audit log。"
        "不要返回“生成病历草稿，等待医生确认”这类二次确认任务；医生确认本任务后会直接进入 Agent taskflow。"
        "有记录病情、修改字段、保存、打开页面等意图时用 explicit_action；无可执行意图用 no_action。"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


@timed("normalize_voice_task_text")
def normalize_voice_task_text(text: str) -> str:
    cleaned = remove_qwen_think_blocks(text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
    for prefix in ("任务：", "Agent 任务：", "整理任务：", "输出："):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
    cleaned = cleaned.strip("\"'“” \n\t")
    if cleaned.startswith("未发现明确需要执行的页面操作"):
        return NO_ACTION_VOICE_TASK_TEXT
    return cleaned[:260]


VOICE_TASK_RESULT_TYPES = {"explicit_action", "no_action", "needs_clarification"}


@timed("normalize_voice_proposed_fields")
def normalize_voice_proposed_fields(raw_items: Any) -> list[dict[str, str]]:
    if not isinstance(raw_items, list):
        return []
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_items:
        if isinstance(item, str):
            field = normalize_contract_field(item)
            value = ""
            label = FIELD_SCHEMA.get(field, {}).get("label", field)
        elif isinstance(item, dict):
            field = normalize_contract_field(item.get("field") or item.get("fieldKey") or item.get("label") or item.get("name"))
            value = clean_contract_value(item.get("value") if "value" in item else item.get("expectedValue") or item.get("expected_value") or item.get("text"))
            label = str(item.get("label") or item.get("fieldLabel") or FIELD_SCHEMA.get(field, {}).get("label", field)).strip()
        else:
            continue
        if not field or field not in EDITABLE_FIELDS:
            continue
        key = field + "\n" + value
        if key in seen:
            continue
        seen.add(key)
        result.append({
            "field": field,
            "label": label or FIELD_SCHEMA.get(field, {}).get("label", field),
            "value": value,
        })
    return result[:12]


@timed("parse_voice_task_result")
def parse_voice_task_result(text: str) -> dict[str, Any]:
    cleaned = remove_qwen_think_blocks(text or "").strip()
    data: dict[str, Any] = {}
    if cleaned:
        try:
            data = json.loads(extract_json_object_text(cleaned))
        except Exception:
            data = {}
    if not isinstance(data, dict):
        data = {}
    task_text = normalize_voice_task_text(str(data.get("task_text") or cleaned or ""))
    result_type = str(data.get("result_type") or "").strip().lower()
    if result_type not in VOICE_TASK_RESULT_TYPES:
        result_type = "no_action" if task_text == NO_ACTION_VOICE_TASK_TEXT else "explicit_action"
    proposed_fields = normalize_voice_proposed_fields(data.get("proposed_fields"))
    reason_summary = str(data.get("reason_summary") or "").strip()[:240]
    if not task_text:
        task_text = NO_ACTION_VOICE_TASK_TEXT
        result_type = "no_action"
    if task_text == NO_ACTION_VOICE_TASK_TEXT and result_type not in {"needs_clarification"}:
        result_type = "no_action"
    return {
        "result_type": result_type,
        "task_text": task_text,
        "proposed_fields": proposed_fields,
        "reason_summary": reason_summary,
    }


@timed("compact_agent_messages")
def compact_agent_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for item in (messages or [])[-8:]:
        if not isinstance(item, dict):
            continue
        compact.append({
            "role": item.get("role"),
            "type": item.get("type"),
            "text": str(item.get("text") or "")[:240],
        })
    return compact


@timed("compact_harness_page_state")
def compact_harness_page_state(page_state: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(page_state, dict):
        return {}
    compact: dict[str, Any] = {}
    for key in ("pageType", "page", "url", "title", "patientId", "route"):
        if key in page_state:
            compact[key] = page_state.get(key)
    for key in ("loginState", "demoAuth"):
        value = page_state.get(key)
        if isinstance(value, dict):
            compact[key] = value
    elements = page_state.get("elements")
    if isinstance(elements, list):
        compact["elements"] = [
            {
                "tag": item.get("tag"),
                "id": item.get("id"),
                "name": item.get("name"),
                "label": str(item.get("label") or "")[:80],
                "text": str(item.get("text") or "")[:120],
                "value": str(item.get("value") or "")[:120],
                "role": item.get("role"),
                "type": item.get("type"),
            }
            for item in elements[-80:]
            if isinstance(item, dict)
        ]
    form_values = page_state.get("formValues") or page_state.get("form_values")
    if isinstance(form_values, dict):
        compact["formValues"] = {str(k): str(v)[:160] for k, v in form_values.items()}
    patients = page_state.get("patients")
    if isinstance(patients, list):
        compact["patients"] = patients[:20]
    for key in ("patientListSummary", "visiblePatientList", "fullPatientIndex"):
        value = page_state.get(key)
        if isinstance(value, list):
            compact[key] = value[:20]
    for key in ("activePatient", "selectedPatient", "currentFilter", "fieldSchema"):
        value = page_state.get(key)
        if isinstance(value, dict):
            compact[key] = value
    return compact


def normalize_harness_page(page: Any) -> str:
    value = str(page or "").strip()
    aliases = {
        "patient-management": "patientManagement",
        "patient_management": "patientManagement",
        "patients": "patientManagement",
        "management": "patientManagement",
        "patient-editor": "patientEditor",
        "patient_editor": "patientEditor",
        "editor": "patientEditor",
        "login.html": "login",
        "dashboard.html": "dashboard",
        "patient-management.html": "patientManagement",
        "patient-editor.html": "patientEditor",
        "index.html": "login",
    }
    value = aliases.get(value, value)
    return value if value in INTERNAL_PAGES else ""


def normalize_harness_field(field: Any) -> str:
    value = str(field or "").strip()
    if value in EDITABLE_FIELDS:
        return value
    lowered = value.lower()
    aliases = {
        "birth_date": "birthDate",
        "birthdate": "birthDate",
        "mobile": "phone",
        "telephone": "phone",
        "emergency_contact": "emergencyContact",
        "emergency_phone": "emergencyPhone",
        "id_type": "idType",
        "id_number": "idNumber",
        "insurance_type": "insuranceType",
        "visit_type": "visitType",
        "has_allergy": "hasAllergy",
        "allergy": "allergyNote",
        "allergy_note": "allergyNote",
        "medical_history": "medicalHistory",
    }
    if lowered in aliases:
        return aliases[lowered]
    canonical_cn_aliases = {
        "主诉": "chiefComplaint",
        "症状描述": "chiefComplaint",
        "现病史": "presentIllness",
        "当前病史": "presentIllness",
        "既往史": "pastHistory",
        "既往病史": "pastHistory",
        "过敏史": "allergyHistory",
        "过敏说明": "allergyHistory",
        "备注": "note",
        "说明": "note",
        "诊断": "diagnosis",
        "生命体征": "vitalSigns",
        "体征": "vitalSigns",
        "检查检验": "examSummary",
        "检查": "examSummary",
        "检验": "examSummary",
        "医嘱": "orders",
        "处方": "orders",
    }
    if value in canonical_cn_aliases:
        return canonical_cn_aliases[value]
    normalized = re.sub(r"[\s:：字段]+", "", value).lower()
    for key, config in FIELD_SCHEMA.items():
        if normalized and normalized == re.sub(r"[\s:：字段]+", "", str(config.get("label") or "")).lower():
            return key
    return ""


def normalize_harness_action_type(action_type: Any) -> str:
    value = str(action_type or "").strip()
    aliases = {
        "navigate": "open_page",
        "go_to_page": "open_page",
        "resolve_patient": "find_patient",
        "resolvePatient": "find_patient",
        "select_patient_by_selector": "find_patient",
        "set_field": "update_patient_field",
        "set_fields": "update_patient_fields",
        "click_save": "save_patient",
        "save": "save_patient",
        "finish": "finish_task",
        "ask_user": "ask_clarification",
    }
    value = aliases.get(value, value)
    return value if value in ALLOWED_HARNESS_ACTIONS else ""


def lift_harness_step_args(raw_step: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    lifted = dict(args)
    passthrough_keys = (
        "patientSelector",
        "patient_selector",
        "patientId",
        "patient_id",
        "name",
        "patientName",
        "phone",
        "idNumber",
        "id_number",
        "query",
        "field",
        "value",
        "updates",
        "page",
        "draftText",
        "draft_text",
        "content",
        "text",
        "note",
        "targetField",
        "target_field",
    )
    for key in passthrough_keys:
        if key in raw_step and key not in lifted:
            lifted[key] = raw_step[key]
    return lifted


def normalize_harness_step(raw_step: Any, index: int) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(raw_step, dict):
        return None, "plan step must be an object"
    action_type = normalize_harness_action_type(raw_step.get("actionType") or raw_step.get("action_type") or raw_step.get("type"))
    if not action_type:
        return None, "unsupported actionType: " + str(raw_step.get("actionType") or raw_step.get("action_type") or raw_step.get("type"))
    args = raw_step.get("args") if isinstance(raw_step.get("args"), dict) else {}
    args = dict(args)
    args = lift_harness_step_args(raw_step, args)
    required_page = normalize_harness_page(raw_step.get("requiredPage") or raw_step.get("required_page") or args.get("page"))
    if action_type in {"open_page", "navigate_internal"}:
        page = normalize_harness_page(args.get("page") or raw_step.get("page") or raw_step.get("value"))
        if not page:
            return None, "navigation page is not allowed"
        args["page"] = page
        required_page = required_page or page
    if action_type == "update_patient_field":
        field = normalize_harness_field(args.get("field") or raw_step.get("field"))
        if not field:
            return None, "update_patient_field requires an editable field"
        args["field"] = field
        args["value"] = "" if args.get("value") is None else args.get("value")
    if action_type == "update_patient_fields":
        updates = args.get("updates")
        if not isinstance(updates, list):
            return None, "update_patient_fields requires updates list"
        normalized_updates = []
        for item in updates:
            if not isinstance(item, dict):
                return None, "updates item must be object"
            field = normalize_harness_field(item.get("field"))
            if not field:
                return None, "updates item has unsupported field"
            normalized_updates.append({"field": field, "value": "" if item.get("value") is None else item.get("value")})
        args["updates"] = normalized_updates
    if action_type in {"create_structured_draft", "write_clinical_note_field"}:
        draft_text = (
            args.get("draftText")
            or args.get("draft_text")
            or args.get("content")
            or args.get("text")
            or raw_step.get("draftText")
            or raw_step.get("draft_text")
            or raw_step.get("content")
            or raw_step.get("text")
        )
        if draft_text is not None:
            args["draftText"] = str(draft_text)
        field = normalize_harness_field(
            args.get("field")
            or args.get("targetField")
            or args.get("target_field")
            or raw_step.get("field")
            or raw_step.get("targetField")
            or raw_step.get("target_field")
            or ("note" if action_type == "create_structured_draft" else "")
        )
        if field:
            args["field"] = field
        if action_type == "write_clinical_note_field" and not field:
            return None, "write_clinical_note_field requires an editable clinical field"
    return {
        "id": str(raw_step.get("id") or f"step_{index + 1}"),
        "goal": str(raw_step.get("goal") or raw_step.get("description") or action_type),
        "requiredPage": required_page,
        "actionType": action_type,
        "args": args,
        "status": "pending",
    }, None


def task_prompt_contract() -> str:
    return (
        "Return strict JSON only. No markdown. Schema: "
        '{"kind":"task|ask_clarification|finish_task","message":"...","task":{'
        '"objective":"...","slots":{},"plan":[{"id":"step_1","goal":"...",'
        '"requiredPage":"login|dashboard|patientManagement|patientEditor","actionType":"...",'
        '"args":{}}]},"clarification":{"question":"...","options":[],"reason":"..."}}. '
        "Allowed actionType values: fill_login_form, submit_login, open_page, navigate_internal, "
        "find_patient, open_patient_editor, update_patient_field, update_patient_fields, save_patient, "
        "verify_patient_field, verify_patient_store, create_structured_draft, write_clinical_note_field, "
        "ask_clarification, finish_task, noop. "
        "Protected HIS actions require an authenticated HIS context: dashboard, patientManagement, patientEditor, "
        "find/select/open patient, update fields, save, verify, and clinical note actions. "
        "When page_state.pageType is login and loginState is not authenticated: "
        "if the user asks a protected HIS task without login credentials or explicit Demo-login consent, set "
        'task.slots.requiresLogin=true, task.slots.loginProvided=false and return a task that waits for user confirmation; '
        "do not plan patient resolver, navigation, field update, save, or verify before login. "
        "If the user provides account/password or explicitly asks to use Demo/default 123/123 login, include "
        "fill_login_form and submit_login as the first steps before any protected HIS step, and set "
        'task.slots.requiresLogin=true, task.slots.loginProvided=true, task.slots.login={"username":"123","password":"123","useDemo":true} when Demo credentials are used. '
        'For patient lookup, use find_patient with args.patientSelector such as {"name":"张伟"}, '
        'or put the same patientSelector on open_patient_editor/update_patient_field. '
        "Do not conclude that a patient is missing before the local patient-store resolver checks fullPatientIndex. "
        "When changing a patient field, include field and value in args. "
        "If task_contract.expected_mutations is present, every mutation is mandatory: include update_patient_field "
        "or update_patient_fields before save_patient, include value exactly as given, then verify each field after save_patient. "
        "Never answer a mutation task with only find_patient/open_patient_editor/save_patient. "
        'For "生成病历草稿", use create_structured_draft with args like '
        '{"patientSelector":{"patientId":"P001"},"field":"note","draftText":"..."}; '
        "this creates a confirmable Agent draft and does not save unless a later save_patient step is explicitly planned. "
        "Exception: when task_origin is voice_confirmed_task or input_route.inputType is voice_session_task, "
        "the doctor has already confirmed the editable voice task. Do not use create_structured_draft for another confirmation card; "
        "plan concrete write actions instead. If chiefComplaint and presentIllness are inferable, use update_patient_fields then save_patient. "
        "If the confirmed voice task only asks to record a freeform clinical note, use write_clinical_note_field for note then save_patient. "
        "If the user explicitly asks to write the draft into a clinical field, use write_clinical_note_field with field and draftText. "
        'Do not use verify_patient_field for virtual fields such as "输出", "output", "result", "draft", or "草稿"; '
        "verify_patient_field is only for editable field keys. "
        "Editable field keys: " + ", ".join(sorted(EDITABLE_FIELDS)) + ". "
        "If the user intent is ambiguous, return kind ask_clarification. Do not invent DOM selectors."
    )


@timed("build_task_planner_prompt")
def build_task_planner_prompt(payload: TaskPlannerRequest) -> list[dict[str, str]]:
    task_contract = mutation_contract_from_payload(payload)
    context = {
        "user_message": payload.user_message,
        "task_origin": payload.task_origin,
        "input_route": payload.input_route,
        "task_contract": task_contract,
        "page_state": compact_harness_page_state(payload.page_state),
        "active_task": payload.active_task,
        "conversation_history": compact_agent_messages(payload.conversation_history),
        "patient_store_summary": payload.patient_store_summary[:20],
        "full_patient_index": (payload.full_patient_index or payload.patient_store_summary)[:20],
        "speaker_turns": compact_conversation_turns(payload.speaker_turns),
    }
    return [
        {"role": "system", "content": "You are the backend LLM planner for a HIS demo web app. You may only plan allowlisted actions. " + task_prompt_contract()},
        {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
    ]


def normalize_clarification(data: dict[str, Any], default_message: str = "") -> dict[str, Any]:
    clarification = data.get("clarification") if isinstance(data.get("clarification"), dict) else {}
    question = str(clarification.get("question") or data.get("message") or default_message or "Please clarify the task.")
    options = clarification.get("options") if isinstance(clarification.get("options"), list) else []
    return {
        "kind": "ask_clarification",
        "message": question,
        "clarification": {
            "question": question,
            "options": [str(item) for item in options[:6]],
            "reason": str(clarification.get("reason") or data.get("reason") or "ambiguous_intent"),
        },
        "confidence": float(data.get("confidence") or 0),
        "errors": [],
    }


@timed("normalize_planner_response")
def normalize_planner_response(data: dict[str, Any], payload: TaskPlannerRequest) -> dict[str, Any]:
    if not isinstance(data, dict):
        return normalize_clarification({}, "Planner did not return an object.")
    kind = str(data.get("kind") or "task")
    if kind in {"ask_clarification", "clarification"}:
        return normalize_clarification(data)
    task = data.get("task") if isinstance(data.get("task"), dict) else data
    raw_plan = task.get("plan") if isinstance(task.get("plan"), list) else data.get("plan")
    if not isinstance(raw_plan, list) or not raw_plan:
        return normalize_clarification(data, "LLM did not return a non-empty plan.")
    plan: list[dict[str, Any]] = []
    errors: list[str] = []
    for index, raw_step in enumerate(raw_plan[:12]):
        step, error = normalize_harness_step(raw_step, index)
        if error:
            errors.append(error)
            continue
        if step:
            plan.append(step)
    if not plan:
        return normalize_clarification({"message": "LLM returned no executable allowlisted steps.", "reason": "; ".join(errors)})
    slots = task.get("slots") if isinstance(task.get("slots"), dict) else {}
    slots = dict(slots)
    task_contract = mutation_contract_from_payload(payload)
    validation_before = validate_plan_against_task_contract(plan, task_contract) if task_contract else {"ok": True, "errors": []}
    validation_after = validation_before
    if task_contract and not validation_before.get("ok"):
        plan = repair_plan_against_task_contract(plan, task_contract)
        validation_after = validate_plan_against_task_contract(plan, task_contract)
    if task_contract:
        slots["task_contract"] = task_contract
        slots["target_patient"] = task_contract.get("target_patient") or slots.get("target_patient") or {}
        slots["expected_mutations"] = task_contract.get("expected_mutations") or []
        slots["requires_save"] = bool(task_contract.get("requires_save", True))
        slots["requires_verification"] = bool(task_contract.get("requires_verification", True))
        slots["plan_validation"] = {
            "ok": bool(validation_after.get("ok")),
            "before_errors": validation_before.get("errors") or [],
            "after_errors": validation_after.get("errors") or [],
            "repaired": bool(validation_before.get("errors") and not validation_after.get("errors")),
        }
        if validation_after.get("errors"):
            errors.extend(str(item) for item in validation_after.get("errors") or [])
    for source in (data, task):
        if not isinstance(source, dict):
            continue
        if "patientSelector" in source and "target_patient" not in slots:
            slots["target_patient"] = source["patientSelector"]
        if "patient_selector" in source and "target_patient" not in slots:
            slots["target_patient"] = source["patient_selector"]
        if "field" in source and "target_field" not in slots:
            slots["target_field"] = source["field"]
        if "value" in source and "target_value" not in slots:
            slots["target_value"] = source["value"]
        if "requiresLogin" in source and "requiresLogin" not in slots:
            slots["requiresLogin"] = bool(source["requiresLogin"])
        if "requires_login" in source and "requiresLogin" not in slots:
            slots["requiresLogin"] = bool(source["requires_login"])
        if "loginProvided" in source and "loginProvided" not in slots:
            slots["loginProvided"] = bool(source["loginProvided"])
        if "login_provided" in source and "loginProvided" not in slots:
            slots["loginProvided"] = bool(source["login_provided"])
        if "useDemoLogin" in source and "useDemoLogin" not in slots:
            slots["useDemoLogin"] = bool(source["useDemoLogin"])
        if "use_demo_login" in source and "useDemoLogin" not in slots:
            slots["useDemoLogin"] = bool(source["use_demo_login"])
        if "login" in source and isinstance(source["login"], dict) and "login" not in slots:
            slots["login"] = source["login"]
        if "credentials" in source and isinstance(source["credentials"], dict) and "login" not in slots:
            slots["login"] = source["credentials"]
        if "precondition" in source and isinstance(source["precondition"], dict) and "precondition" not in slots:
            slots["precondition"] = source["precondition"]
    return {
        "kind": "task",
        "message": str(data.get("message") or "Task planned by backend LLM."),
        "task": {
            "task_id": str(task.get("task_id") or f"task_{int(time.time() * 1000)}"),
            "objective": str(task.get("objective") or payload.user_message),
            "status": "running",
            "slots": slots,
            "plan": plan,
            "current_step_index": int(task.get("current_step_index") or 0),
            "created_at": time.time(),
            "updated_at": time.time(),
        },
        "confidence": float(data.get("confidence") or 0.6),
        "errors": errors,
    }


@timed("build_next_step_prompt")
def build_next_step_prompt(payload: NextStepRequest) -> list[dict[str, str]]:
    context = {
        "active_task": payload.active_task,
        "page_state": compact_harness_page_state(payload.page_state),
        "last_action_result": payload.last_action_result,
        "patient_store_summary": payload.patient_store_summary[:20],
        "full_patient_index": (payload.full_patient_index or payload.patient_store_summary)[:20],
    }
    contract = (
        'Return strict JSON only: {"kind":"action|ask_clarification|finish_task",'
        '"message":"...","action":{"type":"allowlisted action","args":{},"expected_result":{},'
        '"continue_after_navigation":false},"clarification":{"question":"...","options":[],"reason":"..."}}. '
        "Use only allowlisted action types from the task plan contract."
    )
    return [
        {"role": "system", "content": "You decide the next allowlisted action for an existing HIS Agent task. " + contract},
        {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
    ]


@timed("normalize_next_step_response")
def normalize_next_step_response(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        return normalize_clarification({}, "Next-step response was not an object.")
    kind = str(data.get("kind") or "action")
    if kind in {"ask_clarification", "clarification"}:
        return normalize_clarification(data)
    if kind in {"finish_task", "finish"}:
        return {"kind": "finish_task", "message": str(data.get("message") or "Task finished."), "confidence": float(data.get("confidence") or 0.8), "errors": []}
    action = data.get("action") if isinstance(data.get("action"), dict) else data
    action_type = normalize_harness_action_type(action.get("type"))
    if not action_type:
        return normalize_clarification({"message": "Next-step action was not allowlisted.", "reason": str(action.get("type"))})
    return {
        "kind": "action",
        "message": str(data.get("message") or "Next action selected by backend LLM."),
        "action": {
            "type": action_type,
            "args": lift_harness_step_args(action, action.get("args") if isinstance(action.get("args"), dict) else {}),
            "expected_result": action.get("expected_result") if isinstance(action.get("expected_result"), dict) else {},
            "continue_after_navigation": bool(action.get("continue_after_navigation")),
        },
        "confidence": float(data.get("confidence") or 0.6),
        "errors": [],
    }


@timed("build_repair_prompt")
def build_repair_prompt(payload: RepairRequest) -> list[dict[str, str]]:
    context = {
        "active_task": payload.active_task,
        "page_state": compact_harness_page_state(payload.page_state),
        "failed_action": payload.failed_action,
        "action_result": payload.action_result,
        "patient_store_summary": payload.patient_store_summary[:20],
        "full_patient_index": (payload.full_patient_index or payload.patient_store_summary)[:20],
    }
    contract = (
        'Return strict JSON only: {"kind":"corrected_action|ask_clarification|finish_task",'
        '"message":"...","action":{"type":"allowlisted action","args":{}},'
        '"clarification":{"question":"...","options":[],"reason":"..."}}.'
    )
    return [
        {"role": "system", "content": "You repair a failed HIS Agent allowlisted action. " + contract},
        {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
    ]


@timed("normalize_repair_response")
def normalize_repair_response(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        return normalize_clarification({}, "Repair response was not an object.")
    kind = str(data.get("kind") or "")
    if kind in {"ask_clarification", "clarification"}:
        return normalize_clarification(data)
    if kind in {"finish_task", "finish"}:
        return {"kind": "finish_task", "message": str(data.get("message") or "Task finished."), "confidence": float(data.get("confidence") or 0.7), "errors": []}
    action = data.get("action") if isinstance(data.get("action"), dict) else {}
    action_type = normalize_harness_action_type(action.get("type"))
    if not action_type:
        return normalize_clarification({"message": "Repair did not return an allowlisted corrected action.", "reason": str(action.get("type"))})
    return {
        "kind": "corrected_action",
        "message": str(data.get("message") or "Corrected action selected by backend LLM."),
        "action": {
            "type": action_type,
            "args": lift_harness_step_args(action, action.get("args") if isinstance(action.get("args"), dict) else {}),
            "expected_result": action.get("expected_result") if isinstance(action.get("expected_result"), dict) else {},
            "continue_after_navigation": bool(action.get("continue_after_navigation")),
        },
        "confidence": float(data.get("confidence") or 0.6),
        "errors": [],
    }


@timed("field_selector_for_action")
def field_selector_for_action(field: str) -> str:
    config = FIELD_SCHEMA.get(field) or {}
    selectors = config.get("selectors") or []
    return selectors[0] if selectors else ""


@timed("command_mentions_any")
def command_mentions_any(command: str, aliases: list[str]) -> bool:
    return any(alias in (command or "") for alias in aliases)


FIELD_ALIASES: dict[str, list[str]] = {
    "phone": ["\u624b\u673a\u53f7", "\u624b\u673a", "\u7535\u8bdd", "\u8054\u7cfb\u7535\u8bdd"],
    "age": ["\u5e74\u9f84"],
    "birthDate": ["\u51fa\u751f\u65e5\u671f", "\u751f\u65e5", "\u51fa\u751f"],
    "idNumber": ["\u8bc1\u4ef6\u53f7\u7801", "\u8bc1\u4ef6\u53f7", "\u8eab\u4efd\u8bc1\u53f7", "\u8eab\u4efd\u8bc1\u53f7\u7801"],
    "address": ["\u5730\u5740", "\u5c45\u4f4f\u5730\u5740"],
    "emergencyContact": ["\u7d27\u6025\u8054\u7cfb\u4eba"],
    "emergencyPhone": ["\u7d27\u6025\u8054\u7cfb\u4eba\u7535\u8bdd", "\u7d27\u6025\u7535\u8bdd", "\u8054\u7cfb\u4eba\u7535\u8bdd"],
    "allergyNote": ["\u8fc7\u654f\u53f2\u8bf4\u660e", "\u8fc7\u654f\u8bf4\u660e", "\u8fc7\u654f\u5907\u6ce8", "\u5bf9", "\u8fc7\u654f"],
    "medicalHistory": ["\u65e2\u5f80\u75c5\u53f2", "\u75c5\u53f2"],
    "symptoms": ["\u4e3b\u8bc9/\u75c7\u72b6\u63cf\u8ff0", "\u4e3b\u8bc9", "\u75c7\u72b6\u63cf\u8ff0", "\u75c7\u72b6", "\u63cf\u8ff0"],
    "remark": ["\u5907\u6ce8", "\u8bf4\u660e"],
    "name": ["\u59d3\u540d", "\u540d\u5b57", "\u6539\u540d", "\u6539\u540d\u4e3a"],
    "chiefComplaint": ["主诉", "症状描述"],
    "presentIllness": ["现病史", "当前病史"],
    "pastHistory": ["既往史", "既往病史"],
    "allergyHistory": ["过敏史", "过敏说明"],
    "vitalSigns": ["生命体征", "体征"],
    "diagnosis": ["诊断"],
    "examSummary": ["检查检验", "检查", "检验"],
    "orders": ["医嘱", "处方"],
    "note": ["备注", "说明"],
}


CONTRACT_MUTATION_FIELDS = {
    "chiefComplaint",
    "presentIllness",
    "pastHistory",
    "medicalHistory",
    "allergyHistory",
    "allergyNote",
    "vitalSigns",
    "diagnosis",
    "examSummary",
    "orders",
    "note",
    "remark",
}

CONTRACT_FIELD_ALIASES: dict[str, list[str]] = {
    "chiefComplaint": ["主诉", "症状描述", "chiefComplaint"],
    "presentIllness": ["现病史", "当前病史", "presentIllness"],
    "pastHistory": ["既往史", "既往病史", "pastHistory"],
    "medicalHistory": ["病史", "既往病史", "medicalHistory"],
    "allergyHistory": ["过敏史", "过敏说明", "allergyHistory"],
    "allergyNote": ["过敏史说明", "过敏备注", "allergyNote"],
    "vitalSigns": ["生命体征", "体征", "vitalSigns"],
    "diagnosis": ["诊断", "diagnosis"],
    "examSummary": ["检查检验", "检查", "检验", "examSummary"],
    "orders": ["医嘱", "处方", "orders"],
    "note": ["备注", "说明", "note"],
    "remark": ["备注", "说明", "remark"],
}

CONTRACT_UPDATE_VERBS = (
    "更新为",
    "修改为",
    "改为",
    "设置为",
    "填写为",
    "补充为",
    "写成",
    "记录为",
    "录入为",
    "变更为",
)


@timed("normalize_contract_field")
def normalize_contract_field(field: Any) -> str:
    canonical = normalize_harness_field(field)
    if canonical in EDITABLE_FIELDS:
        return canonical
    text = str(field or "").strip()
    normalized = re.sub(r"[\s:：字段]+", "", text).lower()
    if not normalized:
        return ""
    for key, aliases in CONTRACT_FIELD_ALIASES.items():
        candidates = aliases + [FIELD_SCHEMA.get(key, {}).get("label", "")]
        for alias in candidates:
            if normalized == re.sub(r"[\s:：字段]+", "", str(alias or "")).lower():
                return key
    return ""


@timed("clean_contract_value")
def clean_contract_value(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^[：:\s\"'“”‘’]+", "", text)
    text = re.sub(r"[\"'“”‘’\s]+$", "", text)
    text = re.sub(r"[，,。；;、\s]*(?:并)?保存[。；;，,\s]*$", "", text)
    text = re.sub(r"[\"'“”‘’\s]+$", "", text)
    return text[:500]


def patient_index_candidates(payload: TaskPlannerRequest | None = None, extra: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if payload:
        candidates.extend(payload.full_patient_index or [])
        candidates.extend(payload.patient_store_summary or [])
        for source in (payload.page_state, payload.input_route):
            if isinstance(source, dict):
                active = source.get("activePatient") or source.get("patient") or source.get("selectedPatient")
                if isinstance(active, dict):
                    candidates.append(active)
    candidates.extend(extra or [])
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        pid = str(item.get("patientId") or item.get("patient_id") or "").strip().upper()
        name = str(item.get("name") or item.get("patientName") or item.get("patient_name") or "").strip()
        key = pid or name
        if not key or key in seen:
            continue
        seen.add(key)
        result.append({"patientId": pid, "name": name})
    return result


@timed("normalize_contract_patient")
def normalize_contract_patient(raw: Any, text: str = "", candidates: list[dict[str, Any]] | None = None) -> dict[str, str]:
    source = raw if isinstance(raw, dict) else {}
    patient_id = str(source.get("patientId") or source.get("patient_id") or source.get("id") or "").strip().upper()
    patient_name = str(source.get("name") or source.get("patientName") or source.get("patient_name") or "").strip()
    haystack = text or ""
    for item in candidates or []:
        pid = str(item.get("patientId") or "").strip().upper()
        name = str(item.get("name") or "").strip()
        if patient_id and pid == patient_id:
            patient_name = name or patient_name
            break
        if not patient_id and pid and pid in haystack:
            patient_id = pid
            patient_name = patient_name or name
            break
        if not patient_name and name and name in haystack:
            patient_name = name
            patient_id = patient_id or pid
            break
    if not patient_id and patient_name and patient_name in PATIENT_NAME_TO_ID:
        patient_id = PATIENT_NAME_TO_ID[patient_name]
    if not patient_name and patient_id:
        for item in candidates or []:
            if str(item.get("patientId") or "").strip().upper() == patient_id:
                patient_name = str(item.get("name") or "").strip()
                break
    return {"patientId": patient_id, "name": patient_name}


@timed("normalize_expected_mutations")
def normalize_expected_mutations(raw_items: Any) -> list[dict[str, str]]:
    source_items = raw_items if isinstance(raw_items, list) else []
    mutations: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in source_items:
        if not isinstance(item, dict):
            continue
        field = normalize_contract_field(item.get("field") or item.get("fieldKey") or item.get("fieldLabel") or item.get("label") or item.get("name"))
        value = clean_contract_value(item.get("value") if "value" in item else item.get("expectedValue") or item.get("expected_value") or item.get("text"))
        if not field or not value:
            continue
        key = field + "\n" + value
        if key in seen:
            continue
        seen.add(key)
        mutations.append({"field": field, "value": value, "fieldLabel": FIELD_SCHEMA.get(field, {}).get("label", field)})
    return mutations


@timed("extract_expected_mutations_from_text")
def extract_expected_mutations_from_text(text: str) -> list[dict[str, str]]:
    source = str(text or "")
    if not source:
        return []
    aliases: list[tuple[str, str]] = []
    for field, field_aliases in CONTRACT_FIELD_ALIASES.items():
        if field not in EDITABLE_FIELDS:
            continue
        for alias in field_aliases + [FIELD_SCHEMA.get(field, {}).get("label", "")]:
            alias_text = str(alias or "").strip()
            if alias_text:
                aliases.append((field, alias_text))
    aliases = sorted(set(aliases), key=lambda item: len(item[1]), reverse=True)
    alias_pattern = "|".join(re.escape(alias) for _, alias in aliases)
    verb_pattern = "|".join(re.escape(verb) for verb in CONTRACT_UPDATE_VERBS)
    mutations: list[dict[str, str]] = []
    seen_fields: set[str] = set()
    for field, alias in aliases:
        if field in seen_fields:
            continue
        pattern = (
            re.escape(alias)
            + r"(?:字段)?\s*(?:"
            + verb_pattern
            + r")\s*[“\"'‘]?(.*?)[”\"'’]?(?=(?:[，,。；;、]\s*)?(?:"
            + alias_pattern
            + r")(?:字段)?\s*(?:"
            + verb_pattern
            + r")|(?:[，,。；;、]\s*)?(?:并)?保存|$)"
        )
        match = re.search(pattern, source, flags=re.S)
        if not match:
            continue
        value = clean_contract_value(match.group(1))
        if not value:
            continue
        seen_fields.add(field)
        mutations.append({"field": field, "value": value, "fieldLabel": FIELD_SCHEMA.get(field, {}).get("label", field)})
    return mutations


@timed("build_task_mutation_contract")
def build_task_mutation_contract(
    text: str,
    raw_contract: dict[str, Any] | None = None,
    patient_context: dict[str, Any] | None = None,
    candidates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    contract = raw_contract if isinstance(raw_contract, dict) else {}
    patient_context = patient_context if isinstance(patient_context, dict) else {}
    raw_mutations = (
        contract.get("expected_mutations")
        or contract.get("mutations")
        or contract.get("expectedMutations")
        or []
    )
    mutations = normalize_expected_mutations(raw_mutations)
    if not mutations:
        mutations = extract_expected_mutations_from_text(text)
    if not mutations:
        return {}
    target_patient = normalize_contract_patient(
        contract.get("target_patient") or contract.get("targetPatient") or patient_context,
        text,
        candidates or [],
    )
    source = str(contract.get("source") or "backend_task_text")
    return {
        "target_patient": target_patient,
        "expected_mutations": mutations,
        "requires_save": bool(contract.get("requires_save", contract.get("requiresSave", ("保存" in text or True)))),
        "requires_verification": bool(contract.get("requires_verification", contract.get("requiresVerification", True))),
        "source": source,
    }


def mutation_contract_from_payload(payload: TaskPlannerRequest) -> dict[str, Any]:
    raw_contract = payload.task_contract if isinstance(payload.task_contract, dict) else {}
    route = payload.input_route if isinstance(payload.input_route, dict) else {}
    if not raw_contract and isinstance(route.get("task_contract"), dict):
        raw_contract = route.get("task_contract") or {}
    candidates = patient_index_candidates(payload)
    return build_task_mutation_contract(payload.user_message, raw_contract, payload.page_state, candidates)


def mutation_to_step_update(mutation: dict[str, str], index: int, patient: dict[str, str]) -> dict[str, Any]:
    patient_selector = {"patientId": patient.get("patientId") or "", "name": patient.get("name") or ""}
    patient_selector = {key: value for key, value in patient_selector.items() if value}
    return {
        "id": f"step_mutation_{index + 1}",
        "goal": "更新" + FIELD_SCHEMA.get(mutation["field"], {}).get("label", mutation["field"]),
        "requiredPage": "patientEditor",
        "actionType": "update_patient_field",
        "args": {"patientSelector": patient_selector, "field": mutation["field"], "value": mutation["value"]},
        "source": "backend_llm",
        "status": "pending",
    }


def mutation_to_step_verify(mutation: dict[str, str], index: int, patient: dict[str, str]) -> dict[str, Any]:
    patient_selector = {"patientId": patient.get("patientId") or "", "name": patient.get("name") or ""}
    patient_selector = {key: value for key, value in patient_selector.items() if value}
    return {
        "id": f"step_verify_{index + 1}",
        "goal": "核对" + FIELD_SCHEMA.get(mutation["field"], {}).get("label", mutation["field"]),
        "requiredPage": "patientEditor",
        "actionType": "verify_patient_field",
        "args": {"patientSelector": patient_selector, "field": mutation["field"], "value": mutation["value"]},
        "source": "backend_llm",
        "status": "pending",
    }


def action_mutations_from_step(step: dict[str, Any]) -> list[dict[str, str]]:
    action_type = step.get("actionType") or step.get("action_type")
    args = step.get("args") if isinstance(step.get("args"), dict) else {}
    if action_type in {"update_patient_field", "verify_patient_field", "write_clinical_note_field"}:
        field = normalize_contract_field(args.get("field") or args.get("fieldLabel"))
        value = clean_contract_value(args.get("value") if "value" in args else args.get("expectedValue") or args.get("draftText"))
        return [{"field": field, "value": value}] if field and value else []
    if action_type == "update_patient_fields":
        return normalize_expected_mutations(args.get("updates"))
    return []


@timed("validate_plan_against_task_contract")
def validate_plan_against_task_contract(plan: list[dict[str, Any]], contract: dict[str, Any]) -> dict[str, Any]:
    expected = normalize_expected_mutations(contract.get("expected_mutations") if isinstance(contract, dict) else [])
    if not expected:
        return {"ok": True, "errors": [], "expected_mutations": []}
    errors: list[str] = []
    save_indexes = [idx for idx, step in enumerate(plan) if (step.get("actionType") or step.get("action_type")) == "save_patient"]
    first_save = save_indexes[0] if save_indexes else -1
    if first_save < 0 and contract.get("requires_save", True):
        errors.append("missing_save_patient")
    for mutation in expected:
        update_indexes: list[int] = []
        verify_indexes: list[int] = []
        for idx, step in enumerate(plan):
            action_type = step.get("actionType") or step.get("action_type")
            mutations = action_mutations_from_step(step)
            matched = any(item.get("field") == mutation["field"] and clean_contract_value(item.get("value")) == mutation["value"] for item in mutations)
            if matched and action_type in {"update_patient_field", "update_patient_fields", "write_clinical_note_field"}:
                update_indexes.append(idx)
            if matched and action_type == "verify_patient_field":
                verify_indexes.append(idx)
        if not update_indexes:
            errors.append("missing_update:" + mutation["field"])
        elif first_save >= 0 and min(update_indexes) > first_save:
            errors.append("update_after_save:" + mutation["field"])
        if contract.get("requires_verification", True):
            if not verify_indexes:
                errors.append("missing_verify:" + mutation["field"])
            elif first_save >= 0 and min(verify_indexes) < first_save:
                errors.append("verify_before_save:" + mutation["field"])
    if len(plan) <= 3 and all((step.get("actionType") or step.get("action_type")) in {"find_patient", "open_patient_editor", "save_patient"} for step in plan):
        errors.append("mutation_task_only_find_open_save")
    return {"ok": not errors, "errors": errors, "expected_mutations": expected}


@timed("repair_plan_against_task_contract")
def repair_plan_against_task_contract(plan: list[dict[str, Any]], contract: dict[str, Any]) -> list[dict[str, Any]]:
    expected = normalize_expected_mutations(contract.get("expected_mutations") if isinstance(contract, dict) else [])
    if not expected:
        return plan
    patient = contract.get("target_patient") if isinstance(contract.get("target_patient"), dict) else {}
    patient_selector = {key: value for key, value in {
        "patientId": str(patient.get("patientId") or "").strip().upper(),
        "name": str(patient.get("name") or "").strip(),
    }.items() if value}
    prefix = [step for step in plan if (step.get("actionType") or step.get("action_type")) in {"fill_login_form", "submit_login"}]
    repaired: list[dict[str, Any]] = []
    repaired.extend(prefix)
    repaired.append({
        "id": "step_find_patient",
        "goal": "查找目标患者",
        "requiredPage": "patientManagement",
        "actionType": "find_patient",
        "args": {"patientSelector": patient_selector},
        "source": "backend_llm",
        "status": "pending",
    })
    repaired.append({
        "id": "step_open_patient_editor",
        "goal": "打开目标患者编辑页",
        "requiredPage": "patientManagement",
        "actionType": "open_patient_editor",
        "args": {"patientSelector": patient_selector},
        "source": "backend_llm",
        "status": "pending",
    })
    for index, mutation in enumerate(expected):
        repaired.append(mutation_to_step_update(mutation, index, patient))
    if contract.get("requires_save", True):
        repaired.append({
            "id": "step_save_patient",
            "goal": "保存患者记录",
            "requiredPage": "patientEditor",
            "actionType": "save_patient",
            "args": {"patientSelector": patient_selector},
            "source": "backend_llm",
            "status": "pending",
        })
    for index, mutation in enumerate(expected):
        repaired.append(mutation_to_step_verify(mutation, index, patient))
    if contract.get("requires_verification", True):
        repaired.append({
            "id": "step_verify_store",
            "goal": "核对 patient-store 保存结果",
            "requiredPage": "patientEditor",
            "actionType": "verify_patient_store",
            "args": {"patientSelector": patient_selector},
            "source": "backend_llm",
            "status": "pending",
        })
    return repaired


@timed("target_for_field")
def target_for_field(field: str) -> dict[str, Any]:
    return {
        "field": field,
        "selector": field_selector_for_action(field),
        "label": FIELD_SCHEMA[field].get("label", field),
    }


@timed("mentioned_field_aliases")
def mentioned_field_aliases(context: str) -> list[str]:
    text = context or ""
    matched: list[str] = []
    for field, aliases in FIELD_ALIASES.items():
        if command_mentions_any(text, aliases):
            matched.append(field)
    return matched


@timed("normalize_action_bool")
def normalize_action_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    text = str(value or "").strip().lower()
    if text in {"true", "1", "yes", "on", "checked", "\u6709", "\u662f", "\u52fe\u9009", "\u52fe\u4e0a"}:
        return True
    if text in {"false", "0", "no", "off", "unchecked", "\u65e0", "\u5426", "\u53d6\u6d88", "\u4e0d\u52fe\u9009"}:
        return False
    return None


@timed("infer_set_field_target")
def infer_set_field_target(context: str, value: Any, allow_ambiguous_context: bool = False) -> dict[str, Any] | None:
    text_value = str(value or "").strip()
    if not text_value:
        return None

    digits = "".join(ch for ch in text_value if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        return target_for_field("phone")
    if len(text_value) == 10 and text_value[4:5] == "-" and text_value[7:8] == "-":
        return target_for_field("birthDate")

    context_text = context or ""
    if any(marker in context_text for marker in ["\u8fc7\u654f\u53f2\u8bf4\u660e", "\u8fc7\u654f\u8bf4\u660e", "\u8fc7\u654f\u5907\u6ce8"]):
        return target_for_field("allergyNote")
    if "\u8fc7\u654f" in context_text and ("\u5bf9" in context_text or "\u8292\u679c" in context_text):
        return target_for_field("allergyNote")
    if any(marker in context_text for marker in ["\u59d3\u540d\u5b57\u6bb5", "\u4fee\u6539\u59d3\u540d", "\u6539\u540d"]):
        return target_for_field("name")

    matched_fields = mentioned_field_aliases(context_text)
    if len(matched_fields) == 1:
        return target_for_field(matched_fields[0])
    if allow_ambiguous_context and matched_fields:
        # Only use broad command context for values with strong field-shaped hints.
        if text_value.isdigit() and "age" in matched_fields:
            return target_for_field("age")
    return None


@timed("infer_action_target_from_value")
def infer_action_target_from_value(action_type: str, value: Any) -> dict[str, Any] | None:
    if action_type == "set_checkbox":
        # The current form has exactly one checkbox field: hasAllergy.
        if normalize_action_bool(value) is not None:
            return target_for_field("hasAllergy")
        return None

    if value is None:
        return None
    text_value = str(value).strip()
    matches: list[str] = []

    for field, config in FIELD_SCHEMA.items():
        options = config.get("options") or []
        if text_value in options:
            if action_type == "set_select" and config.get("kind") == "select":
                matches.append(field)
            elif action_type == "set_radio" and config.get("kind") == "radio":
                matches.append(field)
            elif action_type in {"set_field", "set_select", "set_radio"}:
                matches.append(field)

    if len(matches) == 1:
        return target_for_field(matches[0])
    return None


@timed("infer_missing_action_target")
def infer_missing_action_target(action_type: str, action: dict[str, Any]) -> dict[str, Any] | None:
    value = action.get("value")
    thought = str(action.get("thought") or "")
    command = str(action.get("sourceCommand") or "")

    if action_type == "set_field":
        return (
            infer_set_field_target(thought, value)
            or infer_action_target_from_value(action_type, value)
            or infer_set_field_target(command, value, allow_ambiguous_context=True)
        )

    if action_type in {"set_select", "set_radio", "set_checkbox"}:
        return infer_action_target_from_value(action_type, value)

    if action_type == "click_button":
        return {"field": "save", "selector": "#saveButton", "label": "saveButton"}

    return None

@timed("validate_universal_action")
def validate_universal_action(action: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(action, dict):
        return None, "Qwen action 不是 JSON object"

    allowed_types = {
        "select_patient",
        "search_patient",
        "set_field",
        "set_select",
        "set_radio",
        "set_checkbox",
        "fill_input",
        "click",
        "navigate",
        "submit_login",
        "update_patient_field",
        "open_page",
        "click_button",
        "read_preview",
        "finish",
        "ask_user",
        "ask_clarification",
        "noop",
        "error",
    }
    action_type = action.get("type")
    if action_type not in allowed_types:
        return None, "不支持的 action.type：" + str(action_type)

    target = action.get("target")
    field_action_types = {"set_field", "set_select", "set_radio", "set_checkbox", "update_patient_field"}
    target_action_types = field_action_types | {"click_button", "fill_input", "click"}

    if action_type == "update_patient_field":
        action_type = "set_field"
        action["type"] = action_type
        field_action_types = {"set_field", "set_select", "set_radio", "set_checkbox"}
        target_action_types = field_action_types | {"click_button", "fill_input", "click"}

    if target is None and action_type in {"set_field", "set_select", "set_radio", "set_checkbox", "click_button"}:
        inferred_target = infer_missing_action_target(action_type, action)
        if inferred_target:
            target = inferred_target
            action["target"] = target
    if action_type == "set_checkbox":
        normalized_bool = normalize_action_bool(action.get("value"))
        if normalized_bool is not None:
            action["value"] = normalized_bool
    if target is not None and not isinstance(target, dict):
        return None, "target must be object or null"

    if action_type == "submit_login":
        value = action.get("value")
        if not isinstance(value, dict):
            value = {}
        normalized_login: dict[str, str] = {}
        if "account" in value or "username" in value:
            normalized_login["account"] = str(value["account"] if "account" in value else value.get("username", ""))
        if "password" in value:
            normalized_login["password"] = str(value.get("password", ""))
        action["value"] = normalized_login

    if action_type in {"navigate", "open_page"}:
        safe_pages = {
            "login",
            "dashboard",
            "patientManagement",
            "patientEditor",
            "login.html",
            "dashboard.html",
            "patient-management.html",
            "patient-editor.html",
            "index.html",
        }
        page_value = str(action.get("value") or (target or {}).get("page") or "").strip()
        if page_value not in safe_pages:
            return None, "导航目标不在安全白名单内：" + page_value
        action["value"] = page_value

    if action_type == "select_patient":
        if target is None:
            target = {}
        patient_value = action.get("value") or target.get("value") or target.get("patientId")
        if not patient_value:
            return None, "select_patient 必须提供 value 或 target.value"
        action["value"] = str(patient_value).strip().upper()
        target["field"] = target.get("field") or "patient"
        target["selector"] = target.get("selector") or "#patientSelect"
        target["label"] = target.get("label") or "选择就诊人"

    if action_type in {"click_button", "click"}:
        if target is None:
            target = {}
        field_value = str(target.get("field") or "")
        if field_value.startswith("#") and not target.get("selector"):
            target["selector"] = field_value
            target["field"] = "save"
        if not target.get("selector") and not target.get("field"):
            target["field"] = "save"
            target["selector"] = "#saveButton"
            target["label"] = "保存修改"

    if action_type == "fill_input":
        if target is None:
            target = {}
        if not target.get("selector") and not target.get("field"):
            return None, "fill_input 必须提供 target.selector 或 target.field"
        if target.get("selector") and not str(target.get("selector")).startswith("#"):
            return None, "fill_input 只允许使用当前页面 id selector"

    if action_type in {"click", "click_button"} and target is not None and target.get("selector") and not str(target.get("selector")).startswith("#"):
        return None, "click 只允许使用当前页面 id selector"

    if action_type in {"select_patient", "set_field", "set_select", "set_radio", "set_checkbox", "click_button", "click", "fill_input"}:
        if not isinstance(target, dict):
            return None, action_type + " 必须提供 target"
        if not target.get("selector") and not target.get("field"):
            return None, action_type + " 的 target 至少需要 selector 或 field"

    if action_type in {"set_field", "set_select", "set_radio", "set_checkbox"}:
        field = target.get("field") if isinstance(target, dict) else ""
        if not field and isinstance(target, dict):
            field = SELECTOR_TO_FIELD.get(str(target.get("selector") or ""), "")
            if field:
                target["field"] = field
        if field not in FIELD_SCHEMA:
            return None, "不支持的字段：" + str(field)
        config = FIELD_SCHEMA[field]
        value = action.get("value")
        if "options" in config and value not in config["options"]:
            return None, config["label"] + " 的字段值不在可选范围内：" + str(value)
        if config["kind"] == "checkbox" and not isinstance(value, bool):
            return None, config["label"] + " 必须是 boolean"

    normalized_action = {
        "thought": str(action.get("thought") or ""),
        "type": action_type,
        "target": target,
        "value": action.get("value"),
        "reason": str(action.get("reason") or ""),
        "done": bool(action.get("done")),
    }
    return normalized_action, None


@timed("validate_universal_plan")
def validate_universal_plan(plan: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(plan, dict):
        return None, "Qwen plan 不是 JSON object"

    patient = plan.get("patient") if isinstance(plan.get("patient"), dict) else {}
    patient_id = (patient.get("patientId") or "").strip().upper()
    patient_name = (patient.get("name") or "").strip()
    if not patient_id and patient_name:
        patient_id = PATIENT_NAME_TO_ID.get(patient_name, "")
    if not patient_id and not patient_name:
        return None, "patientId 或 name 至少需要一个"
    if patient_id and not patient_id.startswith("P"):
        return None, "patientId 格式不正确：" + patient_id

    raw_updates = plan.get("updates")
    if not isinstance(raw_updates, dict):
        return None, "updates 必须是 JSON object"

    normalized_updates: dict[str, Any] = {}
    for field, value in raw_updates.items():
        if value is None or value == "":
            continue
        if field not in FIELD_SCHEMA:
            return None, "不支持的字段：" + str(field)
        config = FIELD_SCHEMA[field]
        if "options" in config and value not in config["options"]:
            return None, config["label"] + " 的字段值不在可选范围内：" + str(value)
        if config["kind"] == "checkbox" and not isinstance(value, bool):
            return None, config["label"] + " 必须是 boolean"
        normalized_updates[field] = value

    if not normalized_updates:
        return None, "updates 中至少需要一个非 null 字段"

    validated = {
        "patient": {"patientId": patient_id, "name": patient_name},
        "updates": {field: normalized_updates.get(field) for field in FIELD_SCHEMA},
        "save": bool(plan.get("save")),
        "intent": "edit_patient",
        "confidence": plan.get("confidence", 0),
    }
    return validated, None


async def first_existing_locator(page: Any, selectors: list[str]) -> Any | None:
    for selector in selectors:
        locator = page.locator(selector)
        if await locator.count() > 0:
            return locator.first
    return None


async def field_locator(page: Any, config: dict[str, Any]) -> Any | None:
    locator = await first_existing_locator(page, config["selectors"])
    if locator:
        return locator
    by_label = page.get_by_label(config["label"], exact=True)
    if await by_label.count() > 0:
        return by_label.first
    return None


async def select_patient(page: Any, patient: dict[str, str], steps: list[str]) -> None:
    patient_id = patient.get("patientId") or ""
    patient_name = patient.get("name") or ""
    if not patient_id and patient_name:
        patient_id = PATIENT_NAME_TO_ID.get(patient_name, "")

    locator = await first_existing_locator(page, ["#patientSelect", '[data-testid="patient-select"]', 'select[name="patientSelect"]'])
    if not locator:
        raise ValueError("未找到就诊人选择控件")

    if patient_id:
        await locator.select_option(patient_id)
        steps.append("已选择就诊人 " + patient_id + ((" " + patient_name) if patient_name else ""))
        return

    selected_id = await page.evaluate(
        """(name) => {
            const select = document.querySelector('#patientSelect,[data-testid="patient-select"],select[name="patientSelect"]');
            if (!select) return '';
            const option = Array.from(select.options).find((item) => item.textContent.includes(name));
            if (!option) return '';
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return option.value;
        }""",
        patient_name,
    )
    if not selected_id:
        raise ValueError("无法根据姓名找到就诊人：" + patient_name)
    patient["patientId"] = selected_id
    steps.append("已选择就诊人 " + selected_id + " " + patient_name)


async def apply_field_update(page: Any, field: str, value: Any, steps: list[str]) -> None:
    config = FIELD_SCHEMA[field]
    label = config["label"]
    kind = config["kind"]

    if kind == "radio":
        locator = await first_existing_locator(page, [f'input[name="visitType"][value="{value}"]', f'[aria-label="就诊类型 {value}"]'])
        if not locator:
            raise ValueError("未找到单选字段：" + label)
        await locator.check()
    elif kind == "checkbox":
        locator = await field_locator(page, config)
        if not locator:
            raise ValueError("未找到复选字段：" + label)
        await locator.set_checked(bool(value))
    else:
        locator = await field_locator(page, config)
        if not locator:
            raise ValueError("未找到字段：" + label)
        if kind == "select":
            await locator.select_option(str(value))
        else:
            await locator.fill(str(value))

    display_value = "是" if value is True else "否" if value is False else str(value)
    steps.append("已修改" + label + "为 " + display_value)


async def execute_plan_with_playwright(plan: dict[str, Any], target_url: str) -> dict[str, Any]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {"ok": False, "mode": "universal-form-agent", "error": "Playwright 未安装，请运行 pip install playwright 并执行 playwright install chromium。"}

    steps = ["已解析任务"]
    browser = None
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=False)
            page = await browser.new_page()
            await page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
            steps.append("已打开页面")

            await select_patient(page, plan["patient"], steps)
            for field, value in plan["updates"].items():
                if value is not None:
                    await apply_field_update(page, field, value, steps)

            if plan["save"]:
                locator = await first_existing_locator(page, ["#saveButton", '[data-testid="save-button"]', 'button[name="saveButton"]'])
                if not locator:
                    locator = page.get_by_role("button", name="保存修改")
                await locator.click()
                steps.append("已点击保存")
                await page.wait_for_timeout(300)

            preview_locator = await first_existing_locator(page, ["#jsonPreview", '[data-testid="json-preview"]'])
            preview = await preview_locator.inner_text(timeout=5000) if preview_locator else ""
            return {
                "ok": True,
                "mode": "universal-form-agent",
                "summary": "任务执行完成",
                "plan": plan,
                "steps": steps,
                "preview": preview,
            }
    except Exception as exc:
        message = str(exc) or exc.__class__.__name__
        if "Executable doesn't exist" in message or "browser" in message.lower():
            message = "浏览器未安装或无法启动，请运行 playwright install chromium。原始错误：" + message
        return {"ok": False, "mode": "universal-form-agent", "error": message, "debug": {"plan": plan}}
    finally:
        if browser:
            try:
                await browser.close()
            except Exception:
                pass


@timed("build_universal_plan_response")
def build_universal_plan_response(payload: AgentRunRequest) -> JSONResponse:
    try:
        command = payload.command.strip()
        if not command:
            return utf8_json({"ok": False, "mode": "universal-form-agent", "error": "command 不能为空"}, 400)

        target_url = normalize_target_url(payload.targetUrl)
        if target_url != ALLOWED_TARGET_URL:
            return utf8_json({"ok": False, "mode": "universal-form-agent", "error": "targetUrl 不被允许"}, 400)

        with timed_block("build_universal_plan_response.call_qwen_for_plan"):
            plan, raw_response, parse_error, llm_info = call_qwen_for_plan(command)
        if not llm_info.get("llmUsed"):
            return utf8_json(
                {
                    "ok": False,
                    "mode": "universal-form-agent",
                    "llmUsed": False,
                    "provider": llm_info.get("provider"),
                    "model": llm_info.get("model"),
                    "error": "Universal Form Agent 必须调用 LLM，但本次没有完成 LLM 调用",
                    "debug": {"reason": parse_error},
                },
                200,
            )

        if parse_error:
            return utf8_json(
                {
                    "ok": False,
                    "mode": "universal-form-agent",
                    "llmUsed": True,
                    "provider": llm_info.get("provider"),
                    "model": llm_info.get("model"),
                    "usage": llm_info.get("usage"),
                    "error": parse_error,
                    "rawResponse": raw_response,
                    "debug": {"rawResponse": raw_response},
                },
                200,
            )


        with timed_block("build_universal_plan_response.validate_universal_plan"):
            validated_plan, validation_error = validate_universal_plan(plan or {})
        if validation_error:
            return utf8_json(
                {
                    "ok": False,
                    "mode": "universal-form-agent",
                    "llmUsed": True,
                    "provider": llm_info.get("provider"),
                    "model": llm_info.get("model"),
                    "usage": llm_info.get("usage"),
                    "error": validation_error,
                    "debug": {"plan": plan, "rawResponse": raw_response},
                },
                200,
            )

        return utf8_json(
            {
                "ok": True,
                "mode": "universal-form-agent",
                "summary": "LLM 已完成任务解析，请在当前页面执行 plan。",
                "llmUsed": True,
                "provider": llm_info.get("provider"),
                "model": llm_info.get("model"),
                "usage": llm_info.get("usage") or {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
                "plan": validated_plan,
                "rawResponse": raw_response,
            },
            200,
        )
    except Exception as exc:
        return utf8_json(
            {
                "ok": False,
                "mode": "universal-form-agent",
                "error": "Universal Form Agent 解析失败：" + (str(exc) or exc.__class__.__name__),
            },
            200,
        )


@app.post("/api/universal-agent/plan", response_model=None)
@timed("endpoint:plan_universal_agent")
async def plan_universal_agent(payload: AgentRunRequest):
    return build_universal_plan_response(payload)


@app.post("/api/universal-agent/next-action", response_model=None)
@timed("endpoint:next_universal_agent_action")
async def next_universal_agent_action(payload: UniversalNextActionRequest):
    return utf8_json(
        {
            "ok": False,
            "mode": "universal-observe-act-agent",
            "deprecated": True,
            "error": "Deprecated endpoint. Use /api/universal-agent/task-plan and the LLM-gated task harness.",
        },
        410,
    )


@app.post("/api/voice/turns-to-agent-task", response_model=None)
@timed("endpoint:voice_turns_to_agent_task")
async def voice_turns_to_agent_task(payload: VoiceTurnsToAgentTaskRequest):
    turns = compact_voice_task_turns(payload.turns)
    if not turns:
        return utf8_json({"ok": False, "message": "没有可整理的 final 医生/患者对话。"}, 200)
    task_text, _raw_response, error, llm_info = call_qwen_text(
        build_voice_turns_to_agent_task_prompt(payload, turns),
        "voice turns to agent task",
        max_tokens=220,
    )
    if error:
        return utf8_json(
            {
                "ok": False,
                "message": "LLM 未能整理就诊会话任务。",
                "error": error,
                "llmUsed": llm_info.get("llmUsed"),
                "provider": llm_info.get("provider"),
                "model": llm_info.get("model"),
                "usage": llm_info.get("usage"),
            },
            200,
        )
    parsed_task = parse_voice_task_result(task_text or "")
    voice_context = compact_voice_patient_context(payload)
    proposed_mutations = normalize_expected_mutations(parsed_task["proposed_fields"])
    task_contract = {}
    if proposed_mutations:
        task_contract = {
            "target_patient": normalize_contract_patient(voice_context, parsed_task["task_text"], [voice_context]),
            "expected_mutations": proposed_mutations,
            "requires_save": True,
            "requires_verification": True,
            "source": "voice_proposed_fields",
        }
    return utf8_json(
        {
            "ok": True,
            "result_type": parsed_task["result_type"],
            "task_text": parsed_task["task_text"],
            "proposed_fields": parsed_task["proposed_fields"],
            "expected_mutations": task_contract.get("expected_mutations", []),
            "task_contract": task_contract,
            "reason_summary": parsed_task["reason_summary"],
            "llmUsed": True,
            "provider": llm_info.get("provider"),
            "model": llm_info.get("model"),
            "usage": llm_info.get("usage"),
        },
        200,
    )


@app.post("/api/universal-agent/task-plan", response_model=None)
@timed("endpoint:task_plan_agent")
async def task_plan_agent(payload: TaskPlannerRequest):
    trace: dict[str, Any] = {"user_message": payload.user_message, "pageState": compact_harness_page_state(payload.page_state), "activeTaskBefore": payload.active_task, "errors": []}
    try:
        trace["taskContract"] = mutation_contract_from_payload(payload)
        planned, raw_response, parse_error, llm_info = call_qwen_json(build_task_planner_prompt(payload), "task planner")
        trace["plannerRawResponse"] = raw_response[:2000] if raw_response else ""
        trace["plannerParsedResponse"] = planned or {}
        if parse_error:
            trace["errors"].append(parse_error)
            return utf8_json({"ok": False, "kind": "error", "message": "Backend LLM planner is unavailable. Agent will not run local natural-language fallback or execute page actions.", "error": parse_error, "llmUsed": llm_info.get("llmUsed"), "provider": llm_info.get("provider"), "model": llm_info.get("model"), "trace": trace}, 200)
        response = normalize_planner_response(planned or {}, payload)
        trace["parsedAgentResponse"] = response
        return utf8_json({"ok": True, "mode": "task-oriented-harness", "llmUsed": True, "provider": llm_info.get("provider"), "model": llm_info.get("model"), "usage": llm_info.get("usage"), "response": response, "rawResponse": raw_response, "trace": trace})
    except Exception as exc:
        trace["errors"].append(str(exc))
        return utf8_json({"ok": False, "kind": "error", "message": "task planner 异常", "error": str(exc), "trace": trace}, 500)


@app.post("/api/universal-agent/task-next-step", response_model=None)
@timed("endpoint:task_next_step_agent")
async def task_next_step_agent(payload: NextStepRequest):
    trace: dict[str, Any] = {"pageState": compact_harness_page_state(payload.page_state), "activeTaskBefore": payload.active_task, "lastActionResult": payload.last_action_result, "errors": []}
    try:
        data, raw_response, parse_error, llm_info = call_qwen_json(build_next_step_prompt(payload), "next step")
        trace["nextStepRawResponse"] = raw_response[:2000] if raw_response else ""
        if parse_error:
            trace["errors"].append(parse_error)
            return utf8_json({"ok": False, "kind": "error", "message": "next-step LLM 不可用", "error": parse_error, "trace": trace}, 200)
        response = normalize_next_step_response(data or {})
        trace["parsedAgentResponse"] = response
        return utf8_json({"ok": True, "mode": "task-oriented-harness", "llmUsed": True, "provider": llm_info.get("provider"), "model": llm_info.get("model"), "usage": llm_info.get("usage"), "response": response, "rawResponse": raw_response, "trace": trace})
    except Exception as exc:
        trace["errors"].append(str(exc))
        return utf8_json({"ok": False, "kind": "error", "message": "next-step 异常", "error": str(exc), "trace": trace}, 500)


@app.post("/api/universal-agent/task-repair", response_model=None)
@timed("endpoint:task_repair_agent")
async def task_repair_agent(payload: RepairRequest):
    trace: dict[str, Any] = {"pageState": compact_harness_page_state(payload.page_state), "activeTaskBefore": payload.active_task, "failedAction": payload.failed_action, "actionResult": payload.action_result, "errors": []}
    try:
        data, raw_response, parse_error, llm_info = call_qwen_json(build_repair_prompt(payload), "repair")
        trace["repairRawResponse"] = raw_response[:2000] if raw_response else ""
        if parse_error:
            trace["errors"].append(parse_error)
            return utf8_json({"ok": False, "kind": "error", "message": "repair LLM 不可用", "error": parse_error, "trace": trace}, 200)
        response = normalize_repair_response(data or {})
        trace["parsedAgentResponse"] = response
        return utf8_json({"ok": True, "mode": "task-oriented-harness", "llmUsed": True, "provider": llm_info.get("provider"), "model": llm_info.get("model"), "usage": llm_info.get("usage"), "response": response, "rawResponse": raw_response, "trace": trace})
    except Exception as exc:
        trace["errors"].append(str(exc))
        return utf8_json({"ok": False, "kind": "error", "message": "repair 异常", "error": str(exc), "trace": trace}, 500)


@app.post("/api/universal-agent/run", response_model=None)
@timed("endpoint:run_universal_agent")
async def run_universal_agent(payload: AgentRunRequest):
    return build_universal_plan_response(payload)

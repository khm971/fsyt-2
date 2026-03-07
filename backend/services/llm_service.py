"""LLM description: local Ollama only. Summarizes video description to plot-only text."""
import logging
import os

import requests

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "300"))


def _query_local_ollama(prompt: str, base_url: str, model: str, timeout: int = OLLAMA_TIMEOUT) -> str | None:
    """
    Query a local Ollama instance.

    Returns:
        Ollama response text, or None on error.
    """
    url = f"{base_url.rstrip('/')}/api/generate"
    data = {
        "model": model,
        "prompt": prompt,
        "stream": False,
    }
    try:
        response = requests.post(url, json=data, timeout=timeout)
        response.raise_for_status()
        result = response.json()
        return result.get("response")
    except requests.exceptions.RequestException as e:
        resp = getattr(e, "response", None)
        status = resp.status_code if resp is not None else None
        logger.error(
            "LLM request failed: url=%s model=%s error=%s message=%s%s",
            url,
            model,
            type(e).__name__,
            str(e),
            f" status={status}" if status is not None else "",
            exc_info=True,
        )
        return None


def generate_llm_video_description(description: str, target_llm: str | None = None) -> str:
    """
    Generate an LLM plot summary from a video description. Uses local Ollama when
    target_llm is None or "ollama". Other values (e.g. Bedrock) return the original
    description unchanged.
    """
    if target_llm is not None and target_llm != "ollama":
        return description or ""

    if not (description or "").strip():
        return ""

    prompt = f"""You will be given a detailed description of a story, which could be from a TV show, movie, or YouTube video. Your task is to extract and present only the plot of the story, without any additional information, introduction, or conclusion.

Here is the story description:
<story_description>
{description}
</story_description>

To complete this task, follow these steps:

1. Carefully read through the entire story description.
2. Identify the main plot points and key events that drive the narrative forward.
3. Disregard any information about production details, cast, crew, or behind-the-scenes facts.
4. Ignore any commentary, reviews, or personal opinions about the story.
5. Focus solely on the sequence of events that make up the core narrative.
6. Organize these events in chronological order.
7. Write a concise summary of the plot, including only the essential elements of the story.

Your response should:
- Begin immediately with the plot summary, without any introductory phrases or sentences.
- Be written in present tense.
- Not include any information about the source material (e.g., "In this movie..." or "The TV show follows...").
- Exclude any conclusion or closing remarks.
- Be contained entirely within <plot> tags.

Provide your plot summary in the following format:

<plot>
[Insert your concise plot summary here, focusing only on the main events and narrative arc of the story.]
</plot>

Remember, your goal is to present only the plot of the story, without any extraneous information or commentary.
"""

    llm_response = _query_local_ollama(prompt, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT)
    if not (llm_response or "").strip():
        logger.error(
            "LLM returned empty or missing response; using original description (base_url=%s model=%s)",
            OLLAMA_BASE_URL,
            OLLAMA_MODEL,
        )
        return description or ""

    out = llm_response.replace("<plot>", "").replace("</plot>", "").strip()
    return out

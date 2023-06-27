import abc
import re

import openai

from .base import LlmApi, Task

from desktop.conf import LLM

_GENERATE = """Act as an {dialect} SQL expert. Translate the NQL statement into SQL using the following metadata: {metadata}.
List any assumptions not covered by the supplied metadata.
NQL: {input}
Wrap the SQL in a <code> tag and the assumptions in a <assumptions> tag"""

_EDIT = """Act as an {dialect} SQL expert. Based on the input modify the SQL using the following metadata: {metadata}.
List any assumptions not covered by the supplied metadata.
SQL query: {sql}
Input: {input}
Wrap the SQL in a <code> tag and the assumptions in a <assumptions> tag"""

_SUMMARIZE = """Act as an {dialect} SQL expert.
Explain in natural language using non technical terms, what this query does: {sql}.
"""

_OPTIMIZE = """Act as an {dialect} SQL expert.
Optimize this SQL query and explain the improvement if any.
Wrap the new code in a <code> tag and the explanation in an <explain> tag with a closing </explain>: {sql}
"""

_FIX = """Act as an {dialect} SQL expert.
Fix this broken sql query and explain the fix.
Wrap the corrected code in a <code> tag and the explaination in an <explain> tag: {sql}
"""

TASK_TEMPLATES = {
    Task.GENERATE: _GENERATE,
    Task.EDIT: _EDIT,
    Task.SUMMARIZE: _SUMMARIZE,
    Task.OPTIMIZE: _OPTIMIZE,
    Task.FIX: _FIX
}

openai.api_key = LLM.OPENAI.TOKEN.get()
_model_name = LLM.OPENAI.MODEL.get()

def extractTagContent(tag, text):
    matches = re.findall(f'<{tag}>(.*?)</{tag}>', text, flags=re.DOTALL)
    return matches[0] if len(matches) > 0 else None

class OpenAiApi(LlmApi):
    def __init__(self):
        super().__init__(TASK_TEMPLATES)

    def infer(self, prompt):
        response = openai.ChatCompletion.create(
            model=_model_name,
            temperature=0,
            messages=[{
                "role": "user",
                "content": prompt
            }]
        )
        choices = response.choices[0]
        return choices.message.content.strip()

    def parse_inference(self, task, inference):
        if task == Task.SUMMARIZE:
            return {
                'summary': inference
            }
        else:
            return {
                'sql': extractTagContent('code', inference),
                'assumptions': extractTagContent('assumptions', inference),
                'explain': extractTagContent('explain', inference),
            }

---
title: 长对话AI部署日记（一）
date: 2026-05-28
category: 技术
description: 免费的Gemini还是过于吃操作了，openrouter才是无脑选择
slug: 20260529-long-talk-gemini
---
## 第一阶段
google cloud注册成功，并且创建项目，
AI studio创建了API
Google cloud启用了API，但是在代码里面无法调用gemini

chatgpt建议下进行测试

进入vene虚拟环境
source venv/bin/activate

Gemini很慢而且经常报错，根据昨天的成功经验，决定使用openrouter的免费模型先把整个流程跑通

至于昨天的成功经验是什么，由于没有写日志，已经忘记了

## 第二阶段
昨天根据chatgpt的指导，建立了个人AI助手的文件夹目录系统，但是还没有正式接入API，本来是想找个好一点的 模型接入，但是发现免费的Gemini太难搞 了（见第一阶段）。

昨天的代码（其实是今天上午）
Pasted image 20260528163748.png

今天的chat.py

``` python
from openai import OpenAI
import json
import os
from datetime import datetime

# ========= OpenRouter 配置 =========

client = OpenAI(
    api_key="你的OpenRouter_API_Key",
    base_url="https://openrouter.ai/api/v1"
)

MODEL_NAME = "google/gemma-3-27b-it:free"

# ========= 文件路径 =========

today = datetime.now().strftime("%Y-%m-%d")

conversation_file = f"conversations/{today}.json"
summary_file = f"summaries/{today}-summary.md"

# ========= 加载长期记忆 =========

memory_text = ""

if os.path.exists("memory/long_memory.md"):
    with open("memory/long_memory.md", "r", encoding="utf-8") as f:
        memory_text = f.read()

# ========= System Prompt =========

system_prompt = f"""
你是我的长期 AI 助手。

你需要：
1. 保持连续对话
2. 记住用户长期目标
3. 回答清晰
4. 结合长期记忆回答

以下是用户长期记忆：

{memory_text}
"""

# ========= 加载历史聊天 =========

messages = [
    {
        "role": "system",
        "content": system_prompt
    }
]

if os.path.exists(conversation_file):
    with open(conversation_file, "r", encoding="utf-8") as f:
        old_messages = json.load(f)
        messages.extend(old_messages)

# ========= 主循环 =========

while True:

    user_input = input("\n你: ")

    # ===== exit 退出 =====

    if user_input.lower() == "exit":

        print("\n正在生成总结...\n")

        summary_prompt = f"""
请总结以下聊天。

输出格式：

# 本次对话总结

## 用户目标
## 已解决问题
## 技术主题
## 用户偏好
## 后续待办
## 值得长期记忆的信息

聊天内容：

{messages}
"""

        summary_response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {
                    "role": "user",
                    "content": summary_prompt
                }
            ]
        )

        summary_text = summary_response.choices[0].message.content

        with open(summary_file, "w", encoding="utf-8") as f:
            f.write(summary_text)

        print("总结已保存。")
        print(f"文件位置: {summary_file}")

        break

    # ===== 添加用户消息 =====

    messages.append(
        {
            "role": "user",
            "content": user_input
        }
    )

    # ===== 请求 AI =====

    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages
    )

    ai_reply = response.choices[0].message.content

    # ===== 输出 AI 回复 =====

    print("\nAI:", ai_reply)

    # ===== 保存 AI 回复 =====

    messages.append(
        {
            "role": "assistant",
            "content": ai_reply
        }
    )

    # ===== 保存聊天记录 =====

    with open(conversation_file, "w", encoding="utf-8") as f:
        json.dump(messages[1:], f, ensure_ascii=False, indent=2)
```

最开始和最后面带三个点的两行去掉，API填入自己的API，模型的名字去openrouter找一个免费的填进去
有任何错误直接复制下来问chatgpt或者claode

这段文字就是长对话AI能够具有记忆的核心，否则接入的AI会忘记之前的对话

下一步就是解决在更换免费模型之后还能不能具有记忆的问题

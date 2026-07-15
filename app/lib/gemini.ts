// Removed GoogleGenAI import, using standard fetch for Groq API

export class RateLimitError extends Error {
  retryDelayMs: number;
  constructor(message: string, retryDelayMs: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryDelayMs = retryDelayMs;
  }
}


export async function generateCrossTalkMessage(senderPhone: string, targetPhone: string, isReply: boolean = false, previousMessage?: string): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const shouldDrift = Math.random() > 0.8; // 20% chance to completely change the topic
  const shouldTypo = Math.random() > 0.9;  // 10% chance to make an intentional typo

  let prompt = "";
  let baseRules = `Rules:
       - Strictly 3 to 10 words maximum per message.
       - Use heavy Egyptian street slang.
       - NO EMOJIS, NO HASHTAGS.
       - If you want to send multiple short messages in a row (like humans do), separate them with "|||". You can send 1 to 3 messages maximum.`;

  if (shouldDrift && isReply) {
    baseRules += `\n       - IMPORTANT: Completely change the subject to something else randomly! Say something like "بقولك ايه صحيح" and bring up a random memory or complaint.`;
  }

  if (shouldTypo) {
    baseRules += `\n       - IMPORTANT: Make an intentional realistic Arabic typo in the first message. Then, send a completely separate message (separated by |||) that ONLY contains the corrected word followed by an asterisk '*'.`;
  }

  if (isReply) {
    prompt = `You are an Egyptian guy chatting with your friend on WhatsApp. Your friend just sent you this message: "${previousMessage}". 
       Write a very realistic, casual, and short Egyptian slang reply to it. 
       ${baseRules}
       - Do NOT start with formal greetings.
       - Make it sound like a leaked real WhatsApp chat.`;
  } else {
    if (previousMessage && previousMessage.trim().length > 0) {
      prompt = `You are an Egyptian guy chatting with your friend on WhatsApp. Here is your recent conversation history:
       ${previousMessage}
       
       Write the NEXT realistic, casual, and short Egyptian slang message to continue this conversation naturally.
       ${baseRules}
       - Make it sound like a leaked real WhatsApp chat.`;
    } else {
      prompt = `You are an Egyptian guy chatting with your friend on WhatsApp. Start a completely random, sudden conversation about ANY topic you want (e.g. work, sports, traffic, hanging out, weather, or a random memory).
       Write a very realistic, casual, and short Egyptian slang message to start this chat.
       ${baseRules}
       - DO NOT say "Hello" or "How are you". Jump directly into the topic.
       - Make it sound like you are complaining, suggesting something, or sharing a random thought casually.`;
    }
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
      })
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 429) {
        // Groq rate limit error
        console.warn(`[Groq API] Rate Limit hit.`);
        
        // Check for Retry-After header or try parsing the error message
        const retryAfter = response.headers.get("retry-after");
        let delayMs = 15000; // Default 15s

        if (retryAfter) {
           const parsed = parseFloat(retryAfter);
           if (!isNaN(parsed)) delayMs = Math.ceil(parsed * 1000) + 2000;
        } else if (data.error && data.error.message) {
           const match = data.error.message.match(/try again in ([\d\.]+)s/i);
           if (match && match[1]) {
             delayMs = Math.ceil(parseFloat(match[1]) * 1000) + 2000;
           }
        }
        
        console.warn(`[Groq API] Pausing for ${delayMs / 1000} seconds.`);
        throw new RateLimitError(`Rate limited. Pausing cross-talk for ${delayMs / 1000}s.`, delayMs);
      }
      throw new Error(`Groq API Error: ${JSON.stringify(data)}`);
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq returned empty response.");

    const rawStr = text.trim().replace(/^["']|["']$/g, '');
    return rawStr.split("|||").map((m: string) => m.trim()).filter(Boolean);
  } catch (error: any) {
    if (error instanceof RateLimitError) throw error;
    console.error(`[Groq API] Failed:`, error.message || error);
    throw error;
  }
}

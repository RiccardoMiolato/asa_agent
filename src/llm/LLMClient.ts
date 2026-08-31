import { LLMMessage } from "./LLMMemory.js";

/**
 * The client is responsible to be the interface between the
 * LLM-Agent and the LLM model
 */
export interface LLMMessage {
    role: string,
    content: string,
}

interface RequestBody {
    model: string,
    max_tokens: number,
    messages: LLMMessage[],
    system?: string,
}

export class LLMClient {
    constructor(
        private readonly model: string,
        private readonly api_url: string,
        private readonly api_key: string,
        private readonly max_tokens: number,
    ) {

    }

    public async callLLM(messages: LLMMessage[], systemPrompt: string): Promise<string> {
        if(!this.api_url)
            throw new Error("API URL not defined");

        const call_url = this.api_url + "/messages";

        const body: RequestBody = {
            model: this.model,
            max_tokens: this.max_tokens,
            messages
        };

        if(systemPrompt)
            body.system = systemPrompt;

        const response = await fetch(call_url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.api_key ?? '',
                },
                body: JSON.stringify(body),
            });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Anthropic API error ${response.status}: ${text}`);
        }

        const data = await response.json();
        return (data.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('');
    }
}
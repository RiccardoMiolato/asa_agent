export class LLMClient {
    constructor(model, api_url, api_key, max_tokens) {
        this.model = model;
        this.api_url = api_url;
        this.api_key = api_key;
        this.max_tokens = max_tokens;
    }
    async callLLM(messages, systemPrompt) {
        if (!this.api_url)
            throw new Error("API URL not defined");
        const call_url = this.api_url + "/messages";
        const body = {
            model: this.model,
            max_tokens: this.max_tokens,
            messages
        };
        if (systemPrompt)
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
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
    }
}
//# sourceMappingURL=LLMClient.js.map
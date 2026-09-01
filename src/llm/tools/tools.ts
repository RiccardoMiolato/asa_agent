function math_eval(expression: string): number {
    try {
        const result = Function(`"use strict"; return (${expression})`)();
        if (typeof result !== 'number' || isNaN(result)) {
            throw new Error('Invalid expression');
        }
        return result;
    } catch (error) {
        throw new Error('Error evaluating expression');
    }
}

function move_to(x: number, y: number): string {
    return `Moving to coordinates (x=${x}, y=${y})`;
}
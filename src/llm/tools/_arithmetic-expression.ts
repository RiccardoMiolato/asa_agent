const MAX_EXPRESSION_LENGTH = 256;

/** Evaluates arithmetic without executing JavaScript source code. */
class ArithmeticExpressionEvaluator {
    private offset = 0;

    private constructor(private readonly expression: string) {}

    static evaluate(expression: string): number {
        if (expression.trim().length === 0) {
            throw new SyntaxError("Arithmetic expression cannot be empty");
        }
        if (expression.length > MAX_EXPRESSION_LENGTH) {
            throw new RangeError("Arithmetic expression is too long");
        }

        const evaluator = new ArithmeticExpressionEvaluator(expression);
        const result = evaluator.parseAdditive();
        evaluator.skipWhitespace();
        if (!evaluator.isAtEnd()) {
            throw new SyntaxError("Unexpected token in arithmetic expression");
        }
        if (!Number.isFinite(result)) {
            throw new RangeError("Arithmetic result must be finite");
        }
        return result;
    }

    private parseAdditive(): number {
        let value = this.parseMultiplicative();
        while (true) {
            if (this.consume("+")) {
                value += this.parseMultiplicative();
            } else if (this.consume("-")) {
                value -= this.parseMultiplicative();
            } else {
                return value;
            }
        }
    }

    private parseMultiplicative(): number {
        let value = this.parseUnary();
        while (true) {
            if (this.startsWith("**")) {
                return value;
            }
            if (this.consume("*")) {
                value *= this.parseUnary();
            } else if (this.consume("/")) {
                value /= this.parseUnary();
            } else if (this.consume("%")) {
                value %= this.parseUnary();
            } else {
                return value;
            }
        }
    }

    private parseUnary(): number {
        if (this.consume("+")) {
            return this.parseUnary();
        }
        if (this.consume("-")) {
            return -this.parseUnary();
        }
        return this.parsePower();
    }

    private parsePower(): number {
        const base = this.parsePrimary();
        if (!this.consume("**")) {
            return base;
        }
        return base ** this.parseUnary();
    }

    private parsePrimary(): number {
        if (this.consume("(")) {
            const value = this.parseAdditive();
            if (!this.consume(")")) {
                throw new SyntaxError("Missing closing parenthesis");
            }
            return value;
        }
        return this.parseNumber();
    }

    private parseNumber(): number {
        this.skipWhitespace();
        const remainingExpression = this.expression.slice(this.offset);
        const match = remainingExpression.match(
            /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/,
        );
        if (match === null) {
            throw new SyntaxError("Expected a number");
        }
        this.offset += match[0].length;
        const value = Number(match[0]);
        if (!Number.isFinite(value)) {
            throw new RangeError("Numeric literal must be finite");
        }
        return value;
    }

    private consume(token: string): boolean {
        this.skipWhitespace();
        if (!this.expression.startsWith(token, this.offset)) {
            return false;
        }
        this.offset += token.length;
        return true;
    }

    private startsWith(token: string): boolean {
        this.skipWhitespace();
        return this.expression.startsWith(token, this.offset);
    }

    private skipWhitespace(): void {
        while (
            this.offset < this.expression.length
            && /\s/.test(this.expression[this.offset])
        ) {
            this.offset += 1;
        }
    }

    private isAtEnd(): boolean {
        return this.offset === this.expression.length;
    }
}

export { ArithmeticExpressionEvaluator };

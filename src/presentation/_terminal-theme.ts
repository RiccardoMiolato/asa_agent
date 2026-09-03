/** ANSI presentation used only when stdout is attached to a color terminal. */
export class TerminalTheme {
    private static readonly RESET = "\u001B[0m";
    private static readonly BOLD = "\u001B[1m";
    private static readonly DIM = "\u001B[2m";
    private static readonly RED = "\u001B[31m";
    private static readonly GREEN = "\u001B[32m";
    private static readonly YELLOW = "\u001B[33m";
    private static readonly BLUE = "\u001B[34m";
    private static readonly VIOLET = "\u001B[35m";
    private static readonly CYAN = "\u001B[36m";

    private readonly enabled: boolean = process.stdout.isTTY
        && process.env.NO_COLOR === undefined;

    heading(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.CYAN]);
    }

    label(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.BLUE]);
    }

    success(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.GREEN]);
    }

    warning(value: string): string {
        return this.decorate(value, [
            TerminalTheme.BOLD,
            TerminalTheme.YELLOW,
        ]);
    }

    error(value: string): string {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.RED]);
    }

    violet(value: string): string {
        return this.decorate(value, [
            TerminalTheme.BOLD,
            TerminalTheme.VIOLET,
        ]);
    }

    muted(value: string): string {
        return this.decorate(value, [TerminalTheme.DIM]);
    }

    private decorate(value: string, codes: readonly string[]): string {
        if (!this.enabled) {
            return value;
        }
        return `${codes.join("")}${value}${TerminalTheme.RESET}`;
    }
}

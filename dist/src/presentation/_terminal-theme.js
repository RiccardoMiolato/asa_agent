/** ANSI presentation used only when stdout is attached to a color terminal. */
export class TerminalTheme {
    constructor() {
        this.enabled = process.stdout.isTTY
            && process.env.NO_COLOR === undefined;
    }
    heading(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.CYAN]);
    }
    label(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.BLUE]);
    }
    success(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.GREEN]);
    }
    warning(value) {
        return this.decorate(value, [
            TerminalTheme.BOLD,
            TerminalTheme.YELLOW,
        ]);
    }
    error(value) {
        return this.decorate(value, [TerminalTheme.BOLD, TerminalTheme.RED]);
    }
    violet(value) {
        return this.decorate(value, [
            TerminalTheme.BOLD,
            TerminalTheme.VIOLET,
        ]);
    }
    muted(value) {
        return this.decorate(value, [TerminalTheme.DIM]);
    }
    decorate(value, codes) {
        if (!this.enabled) {
            return value;
        }
        return `${codes.join("")}${value}${TerminalTheme.RESET}`;
    }
}
TerminalTheme.RESET = "\u001B[0m";
TerminalTheme.BOLD = "\u001B[1m";
TerminalTheme.DIM = "\u001B[2m";
TerminalTheme.RED = "\u001B[31m";
TerminalTheme.GREEN = "\u001B[32m";
TerminalTheme.YELLOW = "\u001B[33m";
TerminalTheme.BLUE = "\u001B[34m";
TerminalTheme.VIOLET = "\u001B[35m";
TerminalTheme.CYAN = "\u001B[36m";
//# sourceMappingURL=_terminal-theme.js.map
// Tiny no-dependency CLI arg helper shared by scripts/ingest-doc-checklist.ts
// and scripts/approve-kb.ts. Long flags only ('--foo value' or '--flag').
// Unknown flags throw; missing required flags throw.

export type ArgSpec = {
  name: string;
  required?: boolean;
  hasValue?: boolean;     // default true
  default?: string;
};

export class CliArgsError extends Error {
  constructor(message: string, public readonly exitCode = 2) {
    super(message);
    this.name = "CliArgsError";
  }
}

export function parseArgs(argv: string[], specs: ArgSpec[]): Record<string, string | true> {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      throw new CliArgsError(`unexpected positional argument: ${a}`);
    }
    const name = a.slice(2);
    const spec = byName.get(name);
    if (!spec) throw new CliArgsError(`unknown flag: --${name}`);
    if (spec.hasValue === false) {
      out[name] = true;
    } else {
      const v = argv[++i];
      if (v === undefined) throw new CliArgsError(`flag --${name} requires a value`);
      out[name] = v;
    }
  }
  for (const s of specs) {
    if (s.required && !(s.name in out)) {
      throw new CliArgsError(`missing required flag: --${s.name}`);
    }
    if (s.default !== undefined && !(s.name in out)) {
      out[s.name] = s.default;
    }
  }
  return out;
}

export function exitWith(code: number, message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n");
  process.exit(code);
}

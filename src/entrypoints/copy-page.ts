import { runCopy } from '@/lib/copy-runner';
import { RUNNER_SYMBOL_KEY, type Page2MdRunner } from '@/lib/protocol';

export default defineUnlistedScript({
  main() {
    const runner: Page2MdRunner = (mode) => runCopy(mode, document);
    Reflect.set(globalThis, Symbol.for(RUNNER_SYMBOL_KEY), runner);
  },
});

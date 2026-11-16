import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentRun, fixRequestMessage, inlineCommand, isShellLanguage, outputTail, pathProgramsIn, placeholdersIn, programAt, requestedScript, runArgv, runRequestMessage, runsScript, runTitle, scriptOf, shellBlocksIn, shellScript, standaloneCommand } from '../packages/surfaces/src/code-run.ts';

test('shell blocks are the shell languages, transcripts included', () => {
  for (const language of ['bash', 'sh', 'shell', 'zsh', 'console', 'shell-session', 'BASH']) assert.ok(isShellLanguage(language), language);
  for (const language of ['', 'text', 'json', 'go', 'typescript', 'diff', 'powershell']) assert.ok(!isShellLanguage(language), language);
});

test('a block runs as written; a transcript keeps its prompted lines without prompts or output', () => {
  assert.equal(shellScript('obin login --profile dev\nclaude mcp add obin -- obin mcp\n', 'bash'), 'obin login --profile dev\nclaude mcp add obin -- obin mcp');
  // Prompts in a bash block make it a transcript too.
  assert.equal(shellScript('$ make build\nok\n$ make test', 'bash'), 'make build\nmake test');
  assert.equal(shellScript('% npm test\n\n> test\n> vitest\n PASS 3 tests', 'zsh'), 'npm test');
  // A console block: output lines dropped, continuations kept.
  assert.equal(shellScript('$ docker run \\\n    --rm alpine \\\n    echo hi\nhi\n$ echo done\ndone', 'console'), 'docker run \\\n    --rm alpine \\\n    echo hi\necho done');
  assert.equal(shellScript('just output\nno prompt', 'console'), '');
  // A `$` inside a line is not a prompt.
  assert.equal(shellScript('echo $HOME', 'sh'), 'echo $HOME');
});

test('placeholders: angle names, ellipses and YOUR_ names; never redirections, heredocs or ./...', () => {
  assert.deepEqual(placeholdersIn('obin login --profile <your-profile> --token <TOKEN>'), ['<your-profile>', '<TOKEN>']);
  assert.deepEqual(placeholdersIn('claude mcp add …'), ['…']);
  assert.deepEqual(placeholdersIn('curl -H "Authorization: Bearer YOUR_API_KEY" https://x'), ['YOUR_API_KEY']);
  assert.deepEqual(placeholdersIn('gh pr create ...'), ['...']);
  for (const clean of ['go test ./...', 'cat < input.txt > out.txt 2>&1', 'cat <<EOF\nhi\nEOF', 'diff <(ls a) <(ls b)', 'echo "a" >> log', 'make up --solutions none'])
    assert.deepEqual(placeholdersIn(clean), [], clean);
});

test('fenced shell blocks of a message, indented ones included, as the renderer shows them', () => {
  const message = 'First:\n\n```bash\nobin login --profile dev\n```\n\nThen:\n\n1. Add it:\n   ```sh\n   claude mcp add obin\n   ```\n\n```json\n{"a":1}\n```\n\n```console\n$ make test\nok\n```';
  assert.deepEqual(shellBlocksIn(message), [{ language: 'bash', script: 'obin login --profile dev' }, { language: 'sh', script: 'claude mcp add obin' }, { language: 'console', script: 'make test' }]);
});

test('inline commands: whole commands, and conservative bare subcommands of a path program', () => {
  for (const command of ['bin/devbox check', 'make', 'make lint', 'npm test', 'go test ./...', './run.sh', './scripts/setup.sh --fast', 'git status', 'claude mcp add obin'])
    assert.ok(standaloneCommand(command), command);
  for (const prose of ['build', 'src/main.go', 'bin/devbox', 'npm', 'go', 'useState', 'README.md', 'a\nb', '// comment', 'main'])
    assert.ok(!standaloneCommand(prose), prose);
  assert.equal(inlineCommand('bin/devbox check'), 'bin/devbox check');
  // Next to `bin/devbox …`, a bare subcommand is that program's.
  assert.equal(inlineCommand('build', 'bin/devbox'), 'bin/devbox build');
  assert.equal(inlineCommand('up --solutions none', 'bin/devbox'), 'bin/devbox up --solutions none');
  // Without such a program, or for words that are never subcommands, nothing.
  assert.equal(inlineCommand('build'), '');
  for (const word of ['main', 'true', 'null', 'MyType', 'foo.bar()', 'a b c d e f', 'npm']) assert.equal(inlineCommand(word, 'bin/devbox'), '', word);
  const message = 'Run `bin/devbox check`, then `build`, then `up --solutions none`. Also `./tools/lint fix` then `again`.';
  const programs = pathProgramsIn(message);
  assert.deepEqual(programs.map(p => p.program), ['bin/devbox', './tools/lint']);
  assert.equal(programAt(programs, message.indexOf('`build`')), 'bin/devbox');
  assert.equal(programAt(programs, message.indexOf('`again`')), './tools/lint');
  // A program in a shell block counts too.
  assert.deepEqual(pathProgramsIn('```bash\n$ bin/devbox check\n```\nthen `build`').map(p => p.program), ['bin/devbox']);
});

test('the Run request carries the exact script, fenced, and is recognized back', () => {
  const script = 'obin login --profile dev\nclaude mcp add obin -- obin mcp';
  const text = runRequestMessage(script, 'bash');
  assert.equal(text, 'Run this and tell me the result:\n```bash\nobin login --profile dev\nclaude mcp add obin -- obin mcp\n```');
  assert.equal(requestedScript(text), script);
  // A transcript goes as the script it runs; a fence inside gets a longer fence.
  assert.equal(runRequestMessage('make test', 'console'), 'Run this and tell me the result:\n```sh\nmake test\n```');
  const fenced = runRequestMessage('cat <<EOF\n```\nEOF');
  assert.match(fenced, /^Run this and tell me the result:\n````sh\n/);
  assert.equal(requestedScript(fenced), 'cat <<EOF\n```\nEOF');
  assert.equal(requestedScript('Please run this'), undefined);
});

test("the agent's run of a block is its matching tool call after the request", () => {
  const script = 'obin login --profile dev';
  const tool = (id: string, command: string, status: 'running' | 'completed' | 'failed', exitCode?: number) => ({ id, name: 'Bash', status, input: { command }, exitCode });
  const messages = [
    { id: '1', type: 'message_delta', text: 'Do this:\n```bash\nobin login --profile dev\n```' },
    { id: '2', type: 'operation_accepted', text: runRequestMessage(script, 'bash'), operationId: 'op-1' },
    { id: '3', type: 'tools', text: '', tools: [tool('a', 'git status', 'completed', 0)] },
  ];
  assert.deepEqual(agentRun(messages, '1', script), { operationId: 'op-1', outcome: undefined });
  messages.push({ id: '4', type: 'tools', text: '', tools: [tool('b', 'cd /w && lazybox run -- obin login --profile dev', 'running')] });
  assert.deepEqual(agentRun(messages, '1', script)?.outcome, { state: 'running' });
  messages[3].tools![0] = tool('b', 'cd /w && lazybox run -- obin login --profile dev', 'completed', 2);
  assert.deepEqual(agentRun(messages, '1', script)?.outcome, { state: 'failed', exitCode: 2 });
  // The agent fixed it and ran it again: the latest call counts.
  messages.push({ id: '5', type: 'tools', text: '', tools: [tool('c', 'lazybox run -- obin login   --profile dev', 'completed', 0)] });
  assert.deepEqual(agentRun(messages, '1', script)?.outcome, { state: 'ok', exitCode: 0 });
  // No request: nothing to show. A later message repeating the block owns later requests.
  assert.equal(agentRun(messages, '3', 'make test'), undefined);
  const later = [...messages, { id: '6', type: 'message_delta', text: 'Again:\n```bash\nobin login --profile dev\n```' }, { id: '7', type: 'operation_accepted', text: runRequestMessage(script, 'bash'), operationId: 'op-2' }];
  assert.equal(agentRun(later, '1', script)?.operationId, 'op-1');
  assert.equal(agentRun(later, '6', script)?.operationId, 'op-2');
  assert.ok(runsScript({ name: 'Bash', input: { command: 'sh -c "make build && make test"' } }, 'make build\n# then\nmake test'));
  assert.ok(!runsScript({ name: 'Bash', input: { command: 'ls' } }, 'make build'));
});

test('running it yourself: one shell, a short title, and the end of the output for a fix', () => {
  assert.deepEqual(runArgv('make a\nmake b'), ['/bin/sh', '-lc', 'make a\nmake b']);
  assert.equal(scriptOf(runArgv('make a')), 'make a');
  assert.equal(scriptOf(['/bin/sh', '-c', 'make a']), '');
  assert.equal(runTitle('# set up\nobin login --profile dev\nclaude mcp add'), 'obin login --profile dev');
  assert.equal(runTitle('x'.repeat(80)).length, 60);
  const output = Array.from({ length: 100 }, (_, i) => `\u001b[31mline ${i}\u001b[0m`).join('\n') + '\n';
  const tail = outputTail(output);
  assert.equal(tail.omitted, 40);
  assert.equal(tail.text.split('\n')[0], 'line 40');
  const message = fixRequestMessage({ script: 'make test', folder: 'api', exitCode: 2, output, truncated: false });
  assert.match(message, /^I ran this myself in `api` and it failed \(exit 2\):\n```sh\nmake test\n```\nThe last 60 lines of its output:\n```text\nline 40\n/);
  assert.match(message, /line 99\n```\nFind out why and fix it\.$/);
  assert.match(fixRequestMessage({ script: 'sleep 9', folder: '', signal: 'SIGTERM', output: '', truncated: false }), /^I ran this myself and it was stopped \(SIGTERM\):[\s\S]*\(no output\)/);
});

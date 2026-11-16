import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeStatus, limitState } from './status.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
const message = (value: object) => value as SDKMessage;
test('child output and task completion cannot replace the main conversation', () => {
  const status = new NativeStatus();
  status.normalize(message({ type: 'system', subtype: 'init', session_id: 'root-native' }));
  const child = status.normalize(message({ type: 'stream_event', session_id: 'child-native', parent_tool_use_id: 'tool-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'child text' } } }));
  assert.equal(status.reference, 'root-native'); assert.equal(child[0].agentId, 'claude-tool:tool-1');
  const started = status.normalize(message({ type: 'system', subtype: 'task_started', task_id: 'task-1', tool_use_id: 'tool-1', run_id: '002', description: 'Review', task_type: 'local_agent' }));
  assert.equal(started[0].agentId, child[0].agentId); assert.equal(started[0].status, 'running');
  assert.deepEqual(status.normalize(message({ type: 'system', subtype: 'task_notification', task_id: 'task-1', run_id: '001', status: 'completed' })), []);
  assert.equal(status.normalize(message({ type: 'system', subtype: 'task_notification', task_id: 'task-1', run_id: '002', status: 'completed' }))[0].status, 'done');
});
test('native quota remains distinct from context and local budget failures', () => {
  const status = new NativeStatus();
  const quota = status.normalize(message({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 100, utilization: 0.85 } }));
  assert.equal(quota[0].account?.state, 'exhausted'); assert.equal(quota[0].account?.resetAt, 100); assert.equal(quota[0].account?.windows?.[0].usedPercent, 85);
  const coarse = status.normalize(message({ type: 'assistant', error: 'rate_limit', message: { content: [] } }));
  assert.equal(coarse.find(e => e.type === 'failure')?.account?.state, 'exhausted');
  const result = status.normalize(message({ type: 'result', is_error: true, subtype: 'error_during_execution', errors: ['generic result'], uuid: 'result' }));
  assert.equal(result.filter(e => e.type === 'failure').length, 0);
  assert.equal(limitState('error_max_turns'), 'budget_exceeded'); assert.equal(limitState('context_length_exceeded'), 'context_full'); assert.equal(limitState('authentication_failed'), 'auth_required');
});
test('background membership reconciles a missing terminal event', () => {
  const status = new NativeStatus();
  status.normalize(message({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'task', task_type: 'local_agent', description: 'Test' }] }));
  assert.equal(status.normalize(message({ type: 'system', subtype: 'background_tasks_changed', tasks: [] }))[0].status, 'unknown');
});


test('unknown quota sentinel is unavailable rather than zero', () => {
 const status = new NativeStatus();
 const events = status.normalize(message({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: -1 } }));
 assert.equal(events[0].account?.windows, undefined);
});

test('thinking and tool phases are observable without exposing reasoning text',()=>{
 const status=new NativeStatus();
 const thinking=status.normalize(message({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}}));
 assert.equal(thinking.find(e=>e.type==='activity')?.status,'thinking');
 const privateDelta=status.normalize(message({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'PRIVATE_REASONING'}}}));
 assert.equal(JSON.stringify(privateDelta).includes('PRIVATE_REASONING'),false);
 const tool=status.normalize(message({type:'stream_event',event:{type:'content_block_start',index:1,content_block:{type:'tool_use',name:'Bash',id:'t',input:{}}}}));
 assert.equal(tool.find(e=>e.type==='activity')?.name,'Bash');
 const text=status.normalize(message({type:'stream_event',event:{type:'content_block_delta',index:2,delta:{type:'text_delta',text:'first chunk'}}}));
 assert.equal(text.find(e=>e.type==='message_delta')?.text,'first chunk');
});
test('tool result previews are bounded before journaling',()=>{
 const status=new NativeStatus();const result=status.normalize(message({type:'user',message:{content:[{type:'tool_result',tool_use_id:'big',content:'x'.repeat(1000000)}]}}));
 const text=JSON.stringify(result);assert.ok(text.length<34000);assert.match(text,/Tool preview truncated/);
});

test('a sub-agent\'s tool calls, results and text are attributed through parent_tool_use_id', () => {
  const status = new NativeStatus();
  status.normalize(message({ type: 'system', subtype: 'init', session_id: 'root-native' }));
  const call = status.normalize(message({ type: 'assistant', parent_tool_use_id: 'spawn', message: { id: 'm1', model: 'm', content: [{ type: 'text', text: 'Looking at the reader.' }, { type: 'thinking', thinking: 'PRIVATE' }, { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.ts' } }] } }));
  assert.equal(JSON.stringify(call).includes('PRIVATE'), false);
  const text = call.find(e => e.type === 'message_delta');
  assert.deepEqual([text?.agentId, text?.parentAgentId, text?.text], ['claude-tool:spawn', 'root', 'Looking at the reader.']);
  const tool = call.find(e => e.type === 'tool_activity');
  assert.equal(tool?.agentId, 'claude-tool:spawn'); assert.equal((tool?.data as any).id, 'read-1');
  const result = status.normalize(message({ type: 'user', parent_tool_use_id: 'spawn', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'ok' }] } }));
  assert.equal(result[0].agentId, 'claude-tool:spawn'); assert.equal((result[0].data as any).status, 'completed');
  // The main agent's text is never taken from whole messages: it streams.
  const root = status.normalize(message({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm2', model: 'm', content: [{ type: 'text', text: 'root text' }] } }));
  assert.equal(root.some(e => e.type === 'message_delta'), false);
});
test('streamed sub-agent text is not repeated by its complete message', () => {
  const status = new NativeStatus();
  const streamed = status.normalize(message({ type: 'stream_event', parent_tool_use_id: 'spawn', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed' } } }));
  assert.equal(streamed.filter(e => e.type === 'message_delta').length, 1);
  const whole = status.normalize(message({ type: 'assistant', parent_tool_use_id: 'spawn', message: { id: 'm', model: 'm', content: [{ type: 'text', text: 'streamed' }] } }));
  assert.equal(whole.filter(e => e.type === 'message_delta').length, 0);
  const next = status.normalize(message({ type: 'assistant', parent_tool_use_id: 'spawn', message: { id: 'm2', model: 'm', content: [{ type: 'text', text: 'forwarded' }] } }));
  assert.equal(next.find(e => e.type === 'message_delta')?.text, 'forwarded');
});
test('task events carry the brief, progress, usage and outcome', () => {
  const status = new NativeStatus();
  const [started] = status.normalize(message({ type: 'system', subtype: 'task_started', task_id: 't', tool_use_id: 'spawn', description: 'Find the bug', subagent_type: 'Explore', task_type: 'local_agent', prompt: 'p'.repeat(9000), is_backgrounded: false, spawn_depth: 1 }));
  assert.equal(started.agentId, 'claude-tool:spawn'); assert.equal(started.name, 'Find the bug');
  const data = started.data as any;
  assert.equal(data.toolUseId, 'spawn'); assert.equal(data.subagentType, 'Explore'); assert.equal(data.backgrounded, false); assert.equal(data.depth, 1); assert.equal(data.taskType, 'local_agent');
  assert.equal(data.prompt.length, 8001); assert.ok(data.prompt.endsWith('…'));
  const [progress] = status.normalize(message({ type: 'system', subtype: 'task_progress', task_id: 't', tool_use_id: 'spawn', description: 'Find the bug', usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 4000 }, last_tool_name: 'Grep', summary: 'Reading the reader' }));
  assert.equal(progress.status, 'running');
  assert.deepEqual(progress.data, { toolUseId: 'spawn', usage: { totalTokens: 1200, toolUses: 3, durationMs: 4000 }, lastTool: 'Grep', summary: 'Reading the reader' });
  const [done] = status.normalize(message({ type: 'system', subtype: 'task_notification', task_id: 't', tool_use_id: 'spawn', status: 'failed', output_file: '', summary: 'It broke', usage: { total_tokens: 2000, tool_uses: 5, duration_ms: 9000 } }));
  assert.equal(done.status, 'failed');
  assert.deepEqual(done.data, { toolUseId: 'spawn', summary: 'It broke', usage: { totalTokens: 2000, toolUses: 5, durationMs: 9000 } });
  // A nested spawn names its parent.
  const [nested] = status.normalize(message({ type: 'system', subtype: 'task_started', task_id: 'n', tool_use_id: 'inner', parent_task_id: 't', description: 'Inner' }));
  assert.equal(nested.parentAgentId, 'claude-tool:spawn');
  // A background command says where its output is kept.
  status.normalize(message({ type: 'system', subtype: 'task_started', task_id: 'b', tool_use_id: 'bash-1', description: 'pytest tests', task_type: 'local_bash' }));
  const [bash] = status.normalize(message({ type: 'system', subtype: 'task_notification', task_id: 'b', tool_use_id: 'bash-1', status: 'completed', output_file: '/tmp/tasks/b.output', summary: '' }));
  assert.equal((bash.data as { outputFile?: string }).outputFile, '/tmp/tasks/b.output');
});
test('task_updated moves a known task and reports its error, once', () => {
  const status = new NativeStatus();
  assert.deepEqual(status.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 'unknown', patch: { status: 'killed' } })), []);
  status.normalize(message({ type: 'system', subtype: 'task_started', task_id: 't', tool_use_id: 'spawn', run_id: '002', description: 'Work' }));
  assert.deepEqual(status.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 't', patch: { status: 'running' } })), [], 'no change, no event');
  assert.deepEqual(status.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 't', run_id: '001', patch: { status: 'killed' } })), [], 'a late run is ignored');
  assert.deepEqual(status.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 't', patch: { status: 'paused' } })), []);
  const [killed] = status.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 't', run_id: '002', patch: { status: 'killed' } }));
  assert.deepEqual([killed.agentId, killed.status], ['claude-tool:spawn', 'stopped']);
  assert.deepEqual(status.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 't', run_id: '002', patch: { status: 'running' } })), [], 'a finished run stays finished');
  const [failed] = status.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 't', patch: { status: 'failed', error: 'boom' } }));
  assert.deepEqual([failed.status, failed.data], ['failed', { error: 'boom' }]);
  for (const [patch, expected] of [['completed', 'done'], ['pending', 'starting']]) {
    const s = new NativeStatus();
    s.normalize(message({ type: 'system', subtype: 'task_started', task_id: 'x', description: 'X' }));
    assert.equal(s.normalize(message({ type: 'system', subtype: 'task_updated', task_id: 'x', patch: { status: patch } }))[0].status, expected);
  }
});

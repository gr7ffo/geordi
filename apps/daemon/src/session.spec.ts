import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';
import type { HostEvent, Meta } from './host.ts';
import { signalTree } from './session-process.ts';
import { resumeSessions, startSession, type Session } from './session.ts';

/** A small ACP peer for the detached host's restart and delivery tests. */
const bin = mkdtempSync(join(tmpdir(), 'geordi-wrapper-'));
const fixture = join(bin, 'fixture.cjs');
writeFileSync(
	fixture,
	`
const out = (msg) => console.log(JSON.stringify({jsonrpc:'2.0', ...msg}));
if (process.env.PID_FILE) require('node:fs').writeFileSync(process.env.PID_FILE, String(process.pid));
const id = 'cli-1';
const update = (u) => out({method:'session/update',params:{sessionId:id,update:u}});
const state = (state, extra) => update({sessionUpdate:'state_update',state,...extra});
const text = (text) => update({sessionUpdate:'agent_message',messageId:'answer',content:[{type:'text',text}]});
const done = () => state('idle',{stopReason:'end_turn',background:[]});
let slow = false;
const configOptions=[{configId:'mode',category:'mode',name:'Mode',type:'select',currentValue:'bypassPermissions',options:[{value:'bypassPermissions',name:'Test'}]}];
require('node:readline').createInterface({input:process.stdin}).on('line', line=>{
 const req=JSON.parse(line);
 const result=result=>out({id:req.id,result});
 switch(req.method){
 case 'initialize': return result({protocolVersion:2,info:{name:'fixture',version:'1'},capabilities:{},authMethods:[]});
 case 'session/resume': if(req.params.sessionId==='unsaved')return out({id:req.id,error:{code:-32002,message:'Resource not found'}});
 case 'session/new': return result({sessionId:id,configOptions});
 case 'session/set_config_option': if(!process.env.REFUSE_MODE)configOptions[0].currentValue=req.params.value;return result({configOptions});
 case 'tool_call/cancel':
  if(req.params.sessionId===id && req.params.toolCallId==='first'){
   state('idle',{stopReason:'end_turn',background:[{type:'tool_call',toolCallId:'second'}]});
   return result({});
  }
  return out({id:req.id,error:{code:-32602,message:'Cannot stop this task'}});
 case 'session/cancel': slow=false;return state('idle',{stopReason:'cancelled'});
 case 'session/prompt': {
  const said=req.params.prompt[0].text;
  if(said==='which mode'){state('running');result({messageId:String(req.id)});text(configOptions[0].currentValue);return done();}
  if(said==='config'){state('running');result({messageId:String(req.id)});text(process.env.CODEX_CONFIG);return done();}
  if(said==='crash')process.exit(3);
  state('running');result({messageId:String(req.id)});
  if(slow){slow=false;text('Steered: '+said);return done();}
  if(said==='slow'){slow=true;return;}
  if(said==='withdraw'){
   out({id:103,method:'elicitation/create',params:{sessionId:id,mode:'form',message:'Still working?',requestedSchema:{type:'object',properties:{reply:{type:'string'}}},_meta:{codex:{delivery:'async'}}}});
   return;
  }
  if(said==='withdraw now'){out({method:'$/cancel_request',params:{requestId:103}});return;}
  if(said==='permission'){
   out({id:104,method:'session/request_permission',params:{sessionId:id,title:'Run tool?',subject:{type:'tool_call',toolCall:{toolCallId:'tool'}},options:[{optionId:'allow',kind:'allow_once',name:'Allow'},{optionId:'deny',kind:'reject_once',name:'Decline'}]}});
   return;
  }
  if(said==='ask'){out({id:101,method:'elicitation/create',params:{sessionId:id,mode:'form',message:'Tea or coffee?',requestedSchema:{type:'object',required:['drink'],properties:{drink:{type:'string',title:'Tea or coffee?',enum:['Tea','Coffee']}}}}});return;}
  if(said==='codex question'){out({id:101,method:'elicitation/create',params:{sessionId:id,mode:'form',message:'Codex needs your input to continue.',requestedSchema:{type:'object',required:['drink'],properties:{drink:{type:'string',title:'Tea or coffee?',description:'Drink',enum:['Tea','Coffee'],_meta:{codex:{isOther:false,isSecret:false}}}}}}});return;}
  if(said==='codex other'){out({id:102,method:'elicitation/create',params:{sessionId:id,mode:'form',message:'Codex needs your input to continue.',requestedSchema:{type:'object',required:['drink'],properties:{drink:{type:'string',title:'Tea or coffee?',oneOf:[{const:'Tea',title:'Tea'},{const:'None of the above',title:'None of the above',description:'Provide a different answer in the note field.'}],_meta:{codex:{isOther:true,isSecret:false}}},drink_note:{type:'string',title:'Additional answer or note',_meta:{codex:{questionId:'drink',role:'user_note',isSecret:false}}}}}}});return;}
  if(said==='pick'){out({id:102,method:'elicitation/create',params:{sessionId:id,mode:'form',message:'Which drinks?',requestedSchema:{type:'object',properties:{question_0:{type:'array',items:{anyOf:[{const:'Tea',title:'Tea'},{const:'Coffee',title:'Coffee'}]}},question_0_custom:{type:'string'}}}}});return;}
  if(said==='plans'){
   const items=(id,entries)=>update({sessionUpdate:'plan_update',plan:{type:'items',planId:id,entries}});
   const step=(status)=>({content:'Run the tests',priority:'medium',status});
   text('First the plan.');
   items('codex-structured-plan',[step('in_progress')]);
   update({sessionUpdate:'plan_update',plan:{type:'markdown',planId:'review',content:'## Proposal'}});
   items('codex-structured-plan',[step('completed')]);
   update({sessionUpdate:'plan_removed',planId:'review'});
   items('plan',[]);return done();
  }
  if(said==='compact'){
   const air=(facts)=>({jetbrains:{air:{version:1,contextCompaction:{version:1,...facts}}}});
   text('Before.');
   update({sessionUpdate:'compaction_update',compactionId:'c1',status:'in_progress',_meta:air({})});
   update({sessionUpdate:'compaction_summary_chunk',compactionId:'c1',content:{type:'text',text:'Kept '}});
   update({sessionUpdate:'compaction_summary_chunk',compactionId:'c1',content:{type:'text',text:'this.'}});
   const end={sessionUpdate:'compaction_update',compactionId:'c1',status:'completed'};
   update(end);update({...end,_meta:air({trigger:'automatic',preTokens:180000,postTokens:20000})});update(end);
   update({sessionUpdate:'compaction_update',compactionId:'c2',status:'failed',error:'Too short'});
   return done();
  }
  if(said==='titles'){
   update({sessionUpdate:'session_info_update',_meta:{codex:{threadStatus:{type:'active'}}}});
   out({method:'session/update',params:{sessionId:'child',update:{sessionUpdate:'session_info_update',title:'A subagent'}}});
   update({sessionUpdate:'session_info_update',title:'Fix the login',updatedAt:'2026-11-18T21:18:40.805Z'});
   return done();
  }
  if(said==='start command'){
   update({sessionUpdate:'tool_call_update',toolCallId:'bg',name:'shell',rawInput:'build',status:'in_progress',content:[{type:'terminal',terminalId:'bg-pty'}]});
   update({sessionUpdate:'terminal_output_chunk',terminalId:'bg-pty',data:Buffer.from('before ').toString('base64')});
   return done();
  }
  if(said==='finish with text'){
   update({sessionUpdate:'tool_call_update',toolCallId:'bg',status:'completed',rawOutput:{exit_code:0},content:[{type:'content',content:{type:'text',text:'before after'}}]});
   return done();
  }
  if(said==='finish command'){
   update({sessionUpdate:'terminal_output_chunk',terminalId:'bg-pty',data:Buffer.from('after').toString('base64')});
   const finished={sessionUpdate:'tool_call_update',toolCallId:'bg',status:'completed'};
   update(finished);update(finished);return done();
  }
  if(said==='interleaved reply'){
   const tool={sessionUpdate:'tool_call_update',toolCallId:'build',name:'shell'};
   const chunk=(text)=>update({sessionUpdate:'agent_message_chunk',messageId:'final',content:{type:'text',text}});
   text('Starting the build.');
   update({...tool,status:'in_progress'});
   chunk('A Svelte');
   update({...tool,status:'completed'});
   chunk('Kit website.');
   return done();
  }
  if(said==='terminal'){
   const tool={sessionUpdate:'tool_call_update',toolCallId:'sh',name:'shell'};
   update({...tool,status:'in_progress'});
   const bytes=Buffer.from('Café');
   for(const part of [bytes.subarray(0,4),bytes.subarray(4)]) update({sessionUpdate:'terminal_output_chunk',terminalId:'sh',data:part.toString('base64')});
   update({...tool,status:'completed'});return done();
  }
  if(said==='usage'){
   const usage={sessionUpdate:'usage_update',used:31432,size:1000000,cost:{amount:0.27,currency:'USD'},_meta:{'_claude/model':'opus'}};
   out({method:'session/update',params:{sessionId:'child',update:{...usage,used:5}}});
   update(usage);const {cost,...later}=usage;update({...later,used:31500});return done();
  }
  if(said==='commands'){
   const commands=update=>update({sessionUpdate:'available_commands_update',availableCommands:[
    {type:'command',name:'review',description:'Review the changes',input:{type:'text',hint:'what to look at'}},
    {type:'command',name:'compact',description:'Summarize',input:null},
    {type:'command',name:'model',description:'Set the model'},
    {type:'command',name:'__hidden',description:'Internal'},
    {type:'command',name:'plan',description:'Plan mode',_meta:{jetbrains:{air:{commandAction:{kind:'setConfigOption'}}}}}
   ]});
   commands(update);commands(update);text('listed');return done();
  }
  if(said==='two tasks'){state('idle',{stopReason:'end_turn',background:['first','second'].map(toolCallId=>({type:'tool_call',toolCallId}))});return;}
  if(said==='background'){text('started');state('idle',{stopReason:'end_turn',background:[{type:'tool_call',toolCallId:'task'}]});setTimeout(()=>{state('running');text('it finished');done();},700);return;}
  text('Heard: '+said);return done();
 }
 default: if(req.id===104){text(req.result.outcome.optionId);return done();} if(req.id===102){text(JSON.stringify(req.result.content));done();return;} if(req.id===101){text('You said '+req.result.content.drink);done();}
 }
}).on('close',()=>setTimeout(()=>process.exit(0),Number(process.env.LINGER??0)));
`
);

const openCodeFixture = join(bin, 'opencode.cjs');
writeFileSync(
	openCodeFixture,
	`
const send = msg => console.log(JSON.stringify({jsonrpc:'2.0', ...msg}));
let prompt;
let model = 'provider/default-model';
let effort = 'medium';
const config = () => [
	{id:'model',category:'model',name:'Model',type:'select',currentValue:model,options:[]},
	{id:'variant',category:'thought_level',name:'Effort',type:'select',currentValue:effort,options:[]}
];
let sessionId;
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
	const req = JSON.parse(line);
	switch (req.method) {
	case 'initialize':
		return send({id:req.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{}}},authMethods:[]}});
	case 'session/new':
 case 'session/resume':
		sessionId = req.params.sessionId ?? 'new-session';
		return send({id:req.id,result:{sessionId,configOptions:config()}});
	case 'session/set_config_option':
		if (req.params.configId === 'model') model = req.params.value;
		else if (req.params.configId === 'variant') effort = req.params.value;
		return send({id:req.id,result:{configOptions:config()}});
	case 'session/prompt':
		prompt = req.id;
		if (req.params.prompt[0].text === 'Change model') {
			const update = (sessionId, configOptions) => send({method:'session/update',params:{sessionId,update:{sessionUpdate:'config_option_update',configOptions}}});
			model = 'provider/other-model';
			effort = 'default';
			update(sessionId, config());
			model = 'provider/child-model';
			update('child-session', config());
		}
		return send({id:'permission',method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'edit'},options:[
			{kind:'allow_once',optionId:'allow',name:'Allow'}, {kind:'reject_once',optionId:'deny',name:'Deny'}
		]}});
	default:
		if (req.id !== 'permission') return;
		send({method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:model+' '+effort+' '+req.result.outcome.optionId}}}});
		send({id:prompt,result:{stopReason:'end_turn'}});
	}
});
`
);

const root = () =>
	mkdtempSync(join(process.platform === 'win32' ? homedir() : tmpdir(), 'geordi-sessions-'));
const meta = (env: Record<string, string> = {}): Meta => ({
	agent: 'claude',
	options: {
		sessionId: 's',
		dir: '',
		cwd: process.cwd(),
		writableRoots: [],
		resumeId: null,
		api: null,
		settings: {},
		// The fixture stands in for the wrapper and the agent's own program: neither need be installed.
		env: { CLAUDE_CODE_EXECUTABLE: process.execPath, CODEX_PATH: process.execPath, ...env }
	}
});

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what: () => boolean, ms = 8000) {
	for (const end = Date.now() + ms; !what();) {
		if (Date.now() > end) throw new Error('That took too long');
		await sleep(20);
	}
}

const started: Session[] = [];
// Windows kills a process tree one command at a time: give it room.
afterAll(() => started.forEach((session) => session.kill()), 60_000);

/** A session with what it has reported so far, and a way to wait for a report. */
function begin(
	prompt: string,
	{
		env = {},
		launch = meta(env),
		deliveryId,
		dir = join(root(), 'w'),
		ready = () => true,
		idle = ''
	}: {
		launch?: Meta;
		deliveryId?: string;
		env?: Record<string, string>;
		dir?: string;
		ready?: () => boolean;
		idle?: string;
	} = {}
) {
	const events: HostEvent[] = [];
	// how long a CLI with nothing to do is kept is the host's to know, from its environment
	if (idle) process.env.GEORDI_SESSION_IDLE_MS = idle;
	const session = startSession(
		launch,
		{ prompt, deliveryId },
		(event) => events.push(event),
		dir,
		ready,
		env.MISSING ? join(bin, 'absent.cjs') : launch.agent === 'opencode' ? openCodeFixture : fixture
	);
	delete process.env.GEORDI_SESSION_IDLE_MS;
	started.push(session);
	const kinds = () => events.map((event) => event.kind);
	const ended = (turns: number) =>
		until(
			() =>
				kinds().filter((kind) => kind.startsWith('turn.') && kind !== 'turn.started').length >=
				turns
		);
	return { session, events, kinds, ended, dir };
}

describe('a session', () => {
	it('keeps the turn baseline while steered and delivers the patch after a disconnect', async () => {
		const cwd = root();
		const launch = meta();
		const gitDir = join(cwd, '.git');
		try {
			execFileSync('git', ['init', '-q', cwd]);
			writeFileSync(join(cwd, 'example'), 'before\n');
			execFileSync('git', ['-C', cwd, 'add', 'example']);
			launch.options.cwd = cwd;
			launch.options.worktree = { path: cwd, branch: 'main', adminDir: gitDir, commonDir: gitDir };
			let online = true;
			const {
				session,
				events,
				kinds,
				ended,
				dir: launchDir
			} = begin('slow', { launch, ready: () => online });
			await until(() => kinds().includes('turn.started'));
			online = false;
			writeFileSync(join(cwd, 'example'), 'during\n');
			session.say({ prompt: 'finish' });
			await until(() =>
				readFileSync(join(launchDir, 'out.jsonl'), 'utf8').includes('turn.completed')
			);
			online = true;
			await ended(1);
			expect(events).toContainEqual(
				expect.objectContaining({
					kind: 'turn.completed',
					diff: expect.objectContaining({
						added: 1,
						removed: 1,
						patch: expect.stringContaining('-before\n+during')
					})
				})
			);
			session.say({ prompt: 'another turn' });
			await ended(2);
			expect(events.filter((event) => event.kind === 'turn.completed').at(-1)).toEqual({
				kind: 'turn.completed'
			});
			session.close();
			await session.done;
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('starts a new session when the one to resume was never saved', async () => {
		const launch = meta();
		launch.options.resumeId = 'unsaved';
		const { events, ended } = begin('which mode', { launch });
		await ended(1);
		expect(events).toContainEqual({ kind: 'resume', id: 'cli-1' });
		expect(events.at(-1)).toEqual({ kind: 'turn.completed' });
	});

	it.each([
		['auto', 'deny'],
		['full-access', 'allow']
	] as const)(
		'resumes OpenCode with the chosen model and %s permissions',
		async (permissionMode, outcome) => {
			const launch = meta({ OPENCODE_PATH: process.execPath });
			launch.agent = 'opencode';
			launch.options.resumeId = 'saved-session';
			launch.options.settings = { model: 'provider/model', effort: 'high', permissionMode };
			const { events, ended } = begin('Edit', { launch });
			await ended(1);
			expect(events).toEqual([
				{ kind: 'turn.started' },
				{ kind: 'resume', id: 'saved-session' },
				{
					kind: 'session.model',
					value: {
						requested: { model: 'provider/model', effort: 'high' },
						model: 'provider/model',
						effort: 'high'
					}
				},
				{ kind: 'text', text: 'provider/model high ' + outcome },
				{ kind: 'turn.completed' }
			]);
		}
	);

	it('reports the OpenCode defaults without selecting a model or effort', async () => {
		const launch = meta({ OPENCODE_PATH: process.execPath });
		launch.agent = 'opencode';
		const { session, ended } = begin('Hello', { launch });
		await ended(1);
		expect(session.live().sessionModel).toEqual({
			requested: {},
			model: 'provider/default-model',
			effort: 'medium'
		});
	});

	it('updates live defaults from the root session and clears an undisclosed effort', async () => {
		const launch = meta({ OPENCODE_PATH: process.execPath });
		launch.agent = 'opencode';
		const { session, ended } = begin('Change model', { launch });
		await ended(1);
		expect(session.live().sessionModel).toEqual({ requested: {}, model: 'provider/other-model' });
	});

	it.skipIf(process.platform !== 'win32')(
		'finds OpenCode when Windows spells PATH in its own case',
		async () => {
			// The daemon reads `process.env`, which ignores case; the host is handed a copy, which
			// says `Path` and found nothing, though Settings said OpenCode was there.
			const dir = mkdtempSync(join(tmpdir(), 'geordi-path-'));
			writeFileSync(join(dir, 'opencode.cmd'), '@echo off\r\n');
			const launch = meta({ Path: dir });
			launch.agent = 'opencode';
			const { events, ended } = begin('Hello', { launch });
			await ended(1);
			expect(events.at(-1)).toEqual({ kind: 'turn.completed' });
		}
	);

	it('declines a tool permission request without asking the person', async () => {
		const { events, ended } = begin('permission');
		await ended(1);
		expect(events).toContainEqual({ kind: 'text', text: 'deny' });
		expect(events.some((event) => event.kind === 'question')).toBe(false);
	});

	it.each([
		['claude', 'auto', 'auto'],
		['claude', 'full-access', 'bypassPermissions'],
		['codex', 'auto', 'agent'],
		['codex', 'full-access', 'agent-full-access']
	] as const)('sets %s to %s on resume', async (agent, permissionMode, mode) => {
		const launch = meta();
		launch.agent = agent;
		launch.options.resumeId = 'cli-1';
		launch.options.settings = { permissionMode };
		const { events, ended } = begin('which mode', { launch });
		await ended(1);
		expect(events).toContainEqual({ kind: 'text', text: mode });
	});

	it.each(['claude', 'codex', 'opencode'] as const)(
		'fails the turn when %s is missing',
		async (agent) => {
			const launch = meta({
				PATH: '',
				CLAUDE_CODE_EXECUTABLE: '',
				CODEX_PATH: '',
				OPENCODE_PATH: ''
			});
			launch.agent = agent;
			const { events, ended } = begin('hello', { launch });
			await ended(1);
			expect(events).toContainEqual({
				kind: 'turn.failed',
				error: expect.stringContaining('could not find `' + agent + '`')
			});
			expect(events.some((event) => event.kind === 'text')).toBe(false);
		}
	);

	it('fails before prompting when the provider keeps a different mode', async () => {
		const launch = meta({ REFUSE_MODE: '1' });
		launch.options.settings.permissionMode = 'auto';
		const { events, ended } = begin('which mode', { launch });
		await ended(1);
		expect(events).toContainEqual({
			kind: 'turn.failed',
			error: expect.stringContaining('permission mode auto')
		});
		expect(events.some((event) => event.kind === 'text')).toBe(false);
	});

	it('runs a turn for what it is told, and another in the same CLI for the next thing', async () => {
		const { session, events, ended } = begin('hello');
		await ended(1);
		expect(events).toEqual([
			{ kind: 'turn.started' },
			{ kind: 'resume', id: 'cli-1' },
			{ kind: 'text', text: 'Heard: hello' },
			{ kind: 'turn.completed' }
		]);
		expect(session.working()).toBe(false);
		expect(session.over()).toBe(false);
		expect(session.resumeId()).toBe('cli-1');

		session.say({ prompt: 'again', deliveryId: 'second' });
		expect(session.working()).toBe(true); // before any word of it has come back
		await ended(2);
		session.say({ prompt: 'again', deliveryId: 'second' });
		expect(session.working()).toBe(false);
		expect(events.slice(4)).toEqual([
			{ kind: 'message.received', id: 'second' },
			{ kind: 'turn.started' },
			{ kind: 'text', text: 'Heard: again' },
			{ kind: 'turn.completed' }
		]);
	});

	it('says when the agent compacts and how it ended, without its summary', async () => {
		const { events, ended } = begin('compact');
		await ended(1);
		expect(events.slice(2)).toEqual([
			{ kind: 'text', text: 'Before.' },
			{ kind: 'compaction', id: 'c1', status: 'running' },
			// Claude says the end, then again with the counts
			{ kind: 'compaction', id: 'c1', status: 'completed' },
			{
				kind: 'compaction',
				id: 'c1',
				status: 'completed',
				tokensBefore: 180000,
				tokensAfter: 20000
			},
			{ kind: 'compaction', id: 'c2', status: 'failed' },
			{ kind: 'turn.completed' }
		]);
	});

	it('normalizes checklist and written plan snapshots and withdrawals in conversation order', async () => {
		const { events, ended } = begin('plans');
		await ended(1);
		expect(events.slice(2)).toEqual([
			{ kind: 'text', text: 'First the plan.' },
			{
				kind: 'plan',
				id: 'codex-structured-plan',
				plan: { type: 'items', entries: [{ content: 'Run the tests', status: 'in_progress' }] }
			},
			{ kind: 'plan', id: 'review', plan: { type: 'markdown', content: '## Proposal' } },
			{
				kind: 'plan',
				id: 'codex-structured-plan',
				plan: { type: 'items', entries: [{ content: 'Run the tests', status: 'completed' }] }
			},
			{ kind: 'plan', id: 'review', plan: null },
			{ kind: 'plan', id: 'plan', plan: null },
			{ kind: 'turn.completed' }
		]);
	});

	it("passes on the title of the agent's own session, not its subagents'", async () => {
		const { events, ended } = begin('titles');
		await ended(1);
		expect(events.slice(2)).toEqual([
			{ kind: 'title', title: 'Fix the login' },
			{ kind: 'turn.completed' }
		]);
	});

	it.each([false, true])('enables Codex questions with API credentials %s', async (withApi) => {
		const config = {
			features: { shell_snapshot: true, default_mode_request_user_input: false },
			mcp_servers: { existing: { command: 'example' } }
		};
		const launch = meta({ CODEX_CONFIG: JSON.stringify(config) });
		launch.agent = 'codex';
		if (withApi) {
			launch.options.api = { url: 'http://forge.test/mcp' };
			launch.apiToken = 'test';
		}
		const { events, ended } = begin('config', { launch });
		await ended(1);
		const output = events.find((e) => e.kind === 'text');
		expect(JSON.parse(output!.text)).toEqual({
			features: { shell_snapshot: true, default_mode_request_user_input: true },
			mcp_servers: {
				...config.mcp_servers,
				...(withApi && {
					geordi: {
						url: 'http://forge.test/mcp',
						bearer_token_env_var: 'GEORDI_API_TOKEN',
						default_tools_approval_mode: 'approve'
					}
				})
			}
		});
	});

	it('shows the Codex question under its short heading', async () => {
		const { events, session, kinds, ended } = begin('codex question', {
			launch: { ...meta(), agent: 'codex' }
		});
		await until(() => kinds().includes('question'));
		const question = events.find((e) => e.kind === 'question')!;
		expect(question.questions[0]).toMatchObject({ header: 'Drink', question: 'Tea or coffee?' });
		session.answer(question.id, ['Coffee']);
		await ended(1);
		expect(events.at(-2)).toEqual({ kind: 'text', text: 'You said Coffee' });
	});

	it.each([
		['Tea', { drink: 'Tea' }],
		['Water', { drink_note: 'Water', drink: 'None of the above' }]
	])('folds the Codex note into the question it belongs to (%j)', async (answer, expected) => {
		const { events, session, kinds, ended } = begin('codex other', {
			launch: { ...meta(), agent: 'codex' }
		});
		await until(() => kinds().includes('question'));
		const question = events.find((e) => e.kind === 'question')!;
		expect(question.questions).toEqual([
			{
				question: 'Tea or coffee?',
				options: [{ label: 'Tea', description: 'Tea' }],
				multiSelect: false
			}
		]);
		session.answer(question.id, [answer]);
		await ended(1);
		expect(events.at(-2)).toEqual({ kind: 'text', text: JSON.stringify(expected) });
	});

	it('closes a withdrawn Codex async request while its turn keeps running', async () => {
		const { events, session, kinds } = begin('withdraw', { launch: { ...meta(), agent: 'codex' } });
		await until(() => kinds().includes('question'));
		session.say({ prompt: 'withdraw now' });
		await until(() => kinds().includes('question.closed'));
		const question = events.find((e) => e.kind === 'question')!;
		expect(question.blocking).toBe(false);
		expect(events.at(-1)).toEqual({ kind: 'question.closed', id: question.id });
		expect(session.working()).toBe(true);
		session.answer(question.id, ['Late']);
		session.stop();
		await until(() => kinds().includes('turn.failed'));
		expect(kinds()).not.toContain('answer.received');
	});

	it('keeps a reply together when an earlier tool finishes between chunks', async () => {
		const { events, ended } = begin('interleaved reply');
		await ended(1);
		expect(events.slice(2)).toEqual([
			{ kind: 'text', text: 'Starting the build.' },
			expect.objectContaining({ kind: 'tool', id: 'build' }),
			expect.objectContaining({ kind: 'tool.result', id: 'build' }),
			{ kind: 'text', text: 'A SvelteKit website.' },
			{ kind: 'turn.completed' }
		]);
	});

	it('keeps shell output across ACP byte chunks', async () => {
		const { events, ended } = begin('terminal');
		await ended(1);
		expect(events).toContainEqual({
			kind: 'tool.result',
			id: 'sh',
			output: 'Café',
			isError: false
		});
	});

	it.each(['finish command', 'finish with text'])(
		'finishes the original background tool once during the next turn (%s)',
		async (prompt) => {
			const { session, events, ended } = begin('start command', {
				launch: { ...meta(), agent: 'codex' }
			});
			await ended(1);
			session.say({ prompt });
			await ended(2);
			expect(events.filter((e) => e.kind !== 'resume')).toEqual([
				{ kind: 'turn.started' },
				{ kind: 'tool', id: 'bg', name: 'shell', input: '"build"' },
				{ kind: 'turn.completed' },
				{ kind: 'turn.started' },
				{ kind: 'tool.result', id: 'bg', output: 'before after', isError: false },
				{ kind: 'turn.completed' }
			]);
		}
	);

	it('steers a turn under way with what is said meanwhile', async () => {
		const { session, events, kinds, ended } = begin('slow');
		await until(() => kinds().includes('resume'));
		session.say({ prompt: 'not that' });
		await ended(1);
		expect(events.slice(2)).toEqual([
			{ kind: 'text', text: 'Steered: not that' },
			{ kind: 'turn.completed' }
		]);
	});

	it('stops a turn and goes on running, to be told what to do instead', async () => {
		const { session, events, kinds, ended } = begin('slow');
		await until(() => kinds().includes('resume'));
		session.stop();
		await ended(1);
		expect(events.at(-1)).toEqual({ kind: 'turn.failed', error: 'Stopped' });
		expect(session.over()).toBe(false);

		session.say({ prompt: 'this instead' });
		await ended(2);
		expect(events.slice(-2)).toEqual([
			{ kind: 'text', text: 'Heard: this instead' },
			{ kind: 'turn.completed' }
		]);
	});

	it('stops one selected background task after reconnect and leaves other tasks available', async () => {
		const sessions = root();
		const first = begin('two tasks', { dir: join(sessions, 'w') });
		await first.ended(1);
		const [one, two] = first.session.live().background!;
		first.session.detach();
		const session = resumeSessions(sessions, () => () => {}).get('w')!;
		started.push(session);
		session.stopTask(one.stopId!);
		await until(() => session.live().background?.length === 1);
		expect(session.live().background).toEqual([two]);
		session.stopTask(two.stopId!);
		await until(() => !!session.live().background?.[0].stopError);
		expect(session.working()).toBe(false);
		session.close();
		await session.done;
	});

	it('reports a turn the agent begins by itself, and is not ended while something runs', async () => {
		const { session, events, ended } = begin('background', { idle: '200' });
		await ended(1);
		expect(session.live().background).toEqual([
			{ type: 'tool_call', id: 'task', toolCallId: 'task', stopId: expect.any(String) }
		]);
		await ended(2);
		expect(session.live().background).toEqual([]);
		expect(events.filter((event) => event.kind !== 'background').slice(4)).toEqual([
			{ kind: 'turn.started' },
			{ kind: 'text', text: 'it finished' },
			{ kind: 'turn.completed' }
		]);
		// with nothing running any more, and nothing to do, its CLI is ended
		expect(await session.done).toEqual([]);
		expect(session.over()).toBe(true);
	});

	it('passes on what the agent asks, and the answer', async () => {
		const { session, events, kinds, ended } = begin('ask');
		await until(() => kinds().includes('question'));
		expect(events.at(-1)).toEqual({
			kind: 'question',
			blocking: true,
			id: expect.any(String),
			questions: [
				{
					question: 'Tea or coffee?',
					options: [{ label: 'Tea' }, { label: 'Coffee' }],
					multiSelect: false
				}
			]
		});
		const question = events.at(-1)!;
		if (question.kind !== 'question') throw new Error('Missing question');
		session.answer(question.id, ['Coffee']);
		await ended(1);
		expect(events.at(-2)).toEqual({ kind: 'text', text: 'You said Coffee' });
	});

	it.each([
		['Tea\nCoffee', { question_0: ['Tea', 'Coffee'] }],
		['Water', { question_0_custom: 'Water' }]
	])('delivers a Claude multi-select answer %j', async (answer, expected) => {
		const { session, events, kinds, ended } = begin('pick');
		await until(() => kinds().includes('question'));
		const question = events.at(-1)!;
		if (question.kind !== 'question') throw new Error('Missing question');
		expect(question.questions).toHaveLength(1);
		expect(question.questions[0]).toMatchObject({
			question: 'Which drinks?',
			multiSelect: true,
			optional: true
		});
		session.answer(question.id, [answer]);
		await ended(1);
		expect(events.at(-2)).toEqual({ kind: 'text', text: JSON.stringify(expected) });
	});

	it('keeps what is said too late for a CLI that is being ended, for the next one', async () => {
		const { session, ended } = begin('hello', { idle: '300', env: { LINGER: '1500' } });
		await ended(1);
		await sleep(900); // idle for long enough: told to end, and taking its time
		session.say({ prompt: 'one more thing' });
		expect(await session.done).toEqual([{ prompt: 'one more thing' }]);
	});
});

describe('a session that goes wrong', () => {
	it('fails the turn when the CLI exits in the middle of it', async () => {
		const { session, events } = begin('crash');
		await session.done;
		expect(events).toEqual([
			{ kind: 'turn.started' },
			{ kind: 'resume', id: 'cli-1' },
			{ kind: 'turn.failed', error: expect.any(String) }
		]);
	});

	it('fails the turn when the CLI does not exist', async () => {
		const { session, events } = begin('hello', { env: { MISSING: '1' } });
		await session.done;
		expect(events.at(-1)).toMatchObject({ kind: 'turn.failed' });
		expect(JSON.stringify(events.at(-1))).toMatch(/missing|absent|closed/i);
	});

	it('ends for good when killed, and says the turn was stopped', async () => {
		const pidFile = join(root(), 'cli.pid');
		const { session, events, kinds, dir } = begin('slow', { env: { PID_FILE: pidFile } });
		await until(() => kinds().includes('resume'));
		const host = JSON.parse(readFileSync(join(dir, 'host.json'), 'utf8')).pid;
		const cli = Number(readFileSync(pidFile, 'utf8'));
		session.kill(); // on Windows, forced: the host notes nothing of it
		await session.done;
		expect(events.at(-1)).toEqual({ kind: 'turn.failed', error: 'Stopped' });
		expect(existsSync(dir)).toBe(false);
		// the host, and what it started
		await until(() => !alive(host) && !alive(cli));
	});
});

describe('with nobody to report to', () => {
	it("keeps everything in the session's files until there is", async () => {
		let connected = false;
		const { events, ended, dir } = begin('hello', { ready: () => connected });
		await until(() => readFileSync(join(dir, 'out.jsonl'), 'utf8').includes('turn.completed'));
		expect(events).toEqual([]);
		connected = true;
		await ended(1);
		expect(events).toHaveLength(4);
	});
});

describe('a daemon restart', () => {
	it('leaves the agent working, and the next daemon carries on where the last one left off', async () => {
		const sessions = root();
		const first = begin('slow', { dir: join(sessions, 'w'), deliveryId: 'first' });
		await until(() => first.kinds().includes('resume'));
		first.session.detach(); // the daemon goes away

		const events: HostEvent[] = [];
		const session = resumeSessions(sessions, () => (event) => events.push(event)).get('w')!;
		started.push(session);
		expect(session.working()).toBe(true); // it knows a turn is under way
		expect(session.resumeId()).toBe('cli-1');
		session.say({ prompt: 'slow', deliveryId: 'first' }); // retry after a lost receipt
		session.say({ prompt: 'still there?' });
		await until(() => events.some((event) => event.kind === 'turn.completed'));
		// nothing is said twice
		expect(events).toEqual([
			{ kind: 'text', text: 'Steered: still there?' },
			{ kind: 'turn.completed' }
		]);
	});

	it('leaves the files kept beside the sessions alone', () => {
		const sessions = root();
		for (const name of ['.daemon.sqlite', '.daemon.sqlite-journal', 'stray'])
			writeFileSync(join(sessions, name), 'kept');
		expect(resumeSessions(sessions, () => () => true).size).toBe(0);
		for (const name of ['.daemon.sqlite', '.daemon.sqlite-journal', 'stray'])
			expect(readFileSync(join(sessions, name), 'utf8')).toBe('kept');
	});

	it("reports how full the root session's context is, and still knows after a daemon restart", async () => {
		const sessions = root();
		const first = begin('usage', { dir: join(sessions, 'w') });
		await first.ended(1);
		const cost = { amount: 0.27, currency: 'USD' };
		// a cost said once stands until the agent says more
		const usage = { used: 31500, size: 1000000, cost };
		expect(first.events.filter((event) => event.kind === 'usage')).toEqual([
			{ kind: 'usage', usage: { ...usage, used: 31432 } },
			{ kind: 'usage', usage }
		]);
		expect(first.session.live().usage).toEqual(usage);
		first.session.detach(); // the daemon goes away

		const session = resumeSessions(sessions, () => () => true).get('w')!;
		started.push(session);
		expect(session.live().usage).toEqual(usage);
	});

	it("knows the agent's commands as last offered, without passing them on again", async () => {
		const sessions = root();
		const first = begin('commands', { dir: join(sessions, 'w') });
		await first.ended(1);
		const offered = [
			{ name: 'review', description: 'Review the changes', hint: 'what to look at' },
			{ name: 'compact', description: 'Summarize' }
		];
		// the same list, offered twice, is said once; what Geordi can't use is left out
		expect(first.events.filter((event) => event.kind === 'commands')).toEqual([
			{ kind: 'commands', commands: offered }
		]);
		expect(first.session.live().commands).toEqual(offered);
		first.session.detach();

		const session = resumeSessions(sessions, () => () => true).get('w')!;
		started.push(session);
		expect(session.live().commands).toEqual(offered);
	});

	it('reports one answer receipt when a restarted daemon retries an answer in flight', async () => {
		const sessions = root();
		const first = begin('ask', { dir: join(sessions, 'w') });
		await until(() => first.kinds().includes('question'));
		const question = first.events.find((event) => event.kind === 'question')!;
		first.session.answer(question.id, ['Coffee']);
		first.session.detach();
		const events: HostEvent[] = [];
		const session = resumeSessions(sessions, () => (event) => events.push(event)).get('w')!;
		started.push(session);
		session.answer(question.id, ['Tea']);
		await until(() => events.some((event) => event.kind === 'turn.completed'));
		expect(events).toEqual([
			{ kind: 'answer.received', id: question.id },
			{ kind: 'text', text: 'You said Coffee' },
			{ kind: 'turn.completed' }
		]);
	});

	it('reports a turn that ended while no daemon was there to see it', async () => {
		const sessions = root();
		const first = begin('hello', { dir: join(sessions, 'w'), ready: () => false });
		await until(() =>
			readFileSync(join(first.dir, 'out.jsonl'), 'utf8').includes('turn.completed')
		);
		first.session.detach();

		const events: HostEvent[] = [];
		const session = resumeSessions(sessions, () => (event) => events.push(event)).get('w')!;
		started.push(session);
		expect(session.working()).toBe(true); // as far as anyone was told
		await until(() => events.length === 4);
		expect(session.working()).toBe(false);
	});

	it("does not take somebody else's process for the session's, nor signal it", async () => {
		const sessions = root();
		const first = begin('slow', { dir: join(sessions, 'w') });
		await until(() => first.kinds().includes('resume'));
		first.session.detach();
		// after a reboot, say: the ID is somebody else's now (ours), started at another time
		const host = join(first.dir, 'host.json');
		const real = JSON.parse(readFileSync(host, 'utf8'));
		writeFileSync(host, JSON.stringify({ pid: process.pid, started: 'long ago' }));

		const events: HostEvent[] = [];
		let acknowledged = false;
		const cursors = new Set<string | undefined>();
		const session = resumeSessions(sessions, () => (event, cursor) => {
			cursors.add(cursor);
			if (events.length === 0) events.push(event);
			return acknowledged;
		}).get('w')!;
		session.kill(); // must not reach us
		await until(() => events.length > 0);
		expect(session.over()).toBe(false);
		expect([...cursors]).toEqual([expect.stringMatching(/\/exit$/)]);
		acknowledged = true;
		await session.done;
		expect(events).toEqual([{ kind: 'turn.failed', error: 'Stopped' }]);
		signalTree(real.pid, 'SIGKILL'); // the real one, which nobody follows any more
	});
});

describe('a launched daemon', { timeout: 60_000 }, () => {
	// The app and the command start the daemon as a child of theirs (on Windows, in a job
	// object that ends its members with it). The agent's session is to outlive both.
	// Linux CI is headless. On the desktop runners, exercise the app's utilityProcess too.
	const launchers = ['win32', 'darwin'].includes(process.platform)
		? ['node', 'electron']
		: ['node'];
	it.each(launchers)('leaves the session running after its %s launcher exits', async (runtime) => {
		const sessions = root();
		const dir = join(sessions, 'w');
		const scripts = mkdtempSync(join(tmpdir(), 'geordi-launch-'));
		const wrapperPid = join(scripts, 'wrapper.pid');
		const daemon = join(scripts, 'daemon.mjs');
		const launcher = join(scripts, 'launcher.cjs');
		writeFileSync(
			daemon,
			`const dir = ${JSON.stringify(dir)};
const { readFileSync } = await import('node:fs');
const { startSession } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'session.ts')).href)});
// nobody to report to: what the host writes waits in its files for the next daemon
startSession(${JSON.stringify(meta({ PID_FILE: wrapperPid }))}, { prompt: 'slow', deliveryId: 'first' }, () => true, dir, () => false, ${JSON.stringify(fixture)});
const out = dir + '/out.jsonl';
setInterval(() => { try { if (readFileSync(out, 'utf8').includes('"resume"')) process.exit(0); } catch {} }, 20);
setTimeout(() => { console.error(readFileSync(dir + '/host.log', 'utf8')); process.exit(1); }, 20000);`
		);
		writeFileSync(
			launcher,
			`const daemon = ${JSON.stringify(daemon)};
if (process.versions.electron) {
	const { app, utilityProcess } = require('electron');
	app.setPath('userData', __dirname);
	app.whenReady().then(() => {
		const child = utilityProcess.fork(daemon, [], { stdio: 'pipe' });
		child.stderr.pipe(process.stderr);
		child.on('exit', (code) => app.exit(code ?? 1));
	});
} else {
	require('node:child_process').spawn(process.execPath, [daemon], { stdio: 'inherit' })
		.on('exit', (code) => process.exit(code ?? 1));
}`
		);
		const executable =
			runtime === 'electron'
				? createRequire(new URL('../../desktop/package.json', import.meta.url))('electron')
				: process.execPath;
		const launched = spawn(executable, [launcher], {
			stdio: 'inherit',
			timeout: 30_000,
			killSignal: 'SIGKILL',
			env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
		});
		const exited = once(launched, 'exit');
		const events: HostEvent[] = [];
		let resumed: Session | undefined;
		const resume = () =>
			(resumed ??= resumeSessions(sessions, () => (event) => events.push(event)).get('w'));
		onTestFinished(async () => {
			// The launcher can fail after starting the host but before we resume it.
			await exited;
			const hostFile = join(dir, 'host.json');
			const host = existsSync(hostFile)
				? JSON.parse(readFileSync(hostFile, 'utf8')).pid
				: undefined;
			const wrapper = existsSync(wrapperPid) ? Number(readFileSync(wrapperPid, 'utf8')) : undefined;
			const remaining = resume();
			remaining?.kill();
			await remaining?.done;
			await until(() => (!host || !alive(host)) && (!wrapper || !alive(wrapper)));
			rmSync(scripts, { recursive: true, force: true });
			rmSync(sessions, { recursive: true, force: true });
		});
		expect((await exited)[0]).toBe(0);
		await sleep(500); // for a job object to have ended its members

		const host = JSON.parse(readFileSync(join(dir, 'host.json'), 'utf8')).pid;
		expect(alive(host)).toBe(true);
		const session = resume()!;
		expect(session.working()).toBe(true);
		session.say({ prompt: 'slow', deliveryId: 'first' }); // a retry, which it has heard
		session.say({ prompt: 'still there?' });
		await until(() => events.some((event) => event.kind === 'turn.completed'));
		expect(events).toEqual([
			{ kind: 'message.received', id: 'first' },
			{ kind: 'turn.started' },
			{ kind: 'resume', id: 'cli-1' },
			{ kind: 'text', text: 'Steered: still there?' },
			{ kind: 'turn.completed' }
		]);
	});
});

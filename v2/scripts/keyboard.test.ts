import {test} from 'node:test';import assert from 'node:assert/strict';import {keyboardPreset,validateKeymap,migrateKeymap,chordBindings,leaderKeys} from '../packages/surfaces/src/keyboard';
test('Vim, tmux and arrow presets remain valid and hierarchical',()=>{for(const preset of ['vim','tmux','arrows'])for(const mac of [true,false])assert.equal(validateKeymap(keyboardPreset(preset,mac)),'',`${preset} mac=${mac}`);assert.equal(keyboardPreset('tmux')['snippets.open'],'Ctrl+b s');assert.equal(keyboardPreset()['navigation.exit'],'] ]');assert.equal(keyboardPreset('tmux',true)['palette.open'],'Meta+k or Meta+Shift+p or Ctrl+b p');});
test('shortcut configuration rejects conflicts and unrecognized keys; only required actions need a key',()=>{const map=keyboardPreset();assert.match(validateKeymap({...map,'workspace.new':map['chat.send']}),/conflicts/);assert.match(validateKeymap({...map,'workspace.new':'nonsense'}),/Invalid key/);assert.match(validateKeymap({...map,'navigation.exit':''}),/Set a shortcut/);assert.equal(validateKeymap({...map,'workspace.new':''}),'');
 // An alternative conflicts as much as a whole value, whatever the modifier order.
 assert.match(validateKeymap({...map,'inbox.open':'] ] i or Shift+Meta+P'},),/conflicts with Command palette|Command palette conflicts/);});
test('Mod+ resolves per platform and chords leave sequence prefixes to the dispatcher',()=>{const mac=keyboardPreset('vim',true),pc=keyboardPreset('vim',false);assert.equal(mac['workspace.select.3'],'Meta+3');assert.equal(pc['workspace.select.3'],'Ctrl+3');assert.equal(mac['files.find'],'] ] f or Meta+p');
 const chords=chordBindings(mac);assert.equal(chords.get('Meta+k'),'palette.open');assert.equal(chords.get('Meta+j'),'attention.next');assert.equal(chords.get('Meta+]'),'conversation.next');
 // tmux: Ctrl+b starts sequences, so it is not a chord action.
 assert.equal(chordBindings(keyboardPreset('tmux',true)).has('Ctrl+b'),false);
 assert.deepEqual(leaderKeys(mac),[']'],'only sequence leaders are reserved from Vim editing');});
test('a keymap saved before the registry keeps its keys and gains the new actions without collisions',()=>{
 // Version 1: thirteen actions, a custom key on inbox.open that a new default also uses.
 const saved={'navigation.exit':'] ]','workspace.new':'] ] w','conversation.new':'] ] c','snippets.open':'] ] s','inbox.open':'] ] n','files.find':'] ] f','files.explorer':'] ] e','artifacts.open':'] ] a','navigation.next':'j','navigation.previous':'k','navigation.parent':'h','navigation.open':'l','chat.send':'Enter'};
 const map=migrateKeymap(saved,[{key:'p',label:'Plan',snippet:'plan',mode:'send'}],true);
 assert.equal(map['inbox.open'],'] ] n','saved keys win');
 assert.equal(map['attention.next'],'Meta+j','a new default that collides with a saved key is dropped, the rest kept');
 assert.equal(map['palette.open'],'Meta+k or Meta+Shift+p','a new leader key taken by the person\'s own ]] menu entry is dropped');
 assert.equal(map['files.find'],'] ] f or Meta+p','Go to file gains Mod+P');
 assert.equal(validateKeymap(map),'');
 // A tmux keymap: new sequences take the saved leader.
 const tmux=migrateKeymap(Object.fromEntries(Object.entries(keyboardPreset('tmux',false)).filter(([id])=>id in saved)),[],false);
 assert.equal(tmux['shortcuts.open'],'? or Ctrl+/ or Ctrl+b ?');assert.equal(validateKeymap(tmux),'');
 // A current save is taken as is: an action deliberately left without keys stays so.
 assert.equal(migrateKeymap({...keyboardPreset('vim',true),'attention.next':'',__version:3},[],true)['attention.next'],'');
 // A version 2 save gains the activity detail keys, unless the person's ]] menu uses them; its own keys stay.
 const v2=Object.fromEntries(Object.entries(keyboardPreset('vim',true)).filter(([id])=>!id.startsWith('activity.')));
 assert.equal(migrateKeymap({...v2,'files.find':'] ] f',__version:2},[],true)['activity.cycle'],'] ] v');
 assert.equal(migrateKeymap({...v2,'files.find':'] ] f',__version:2},[],true)['files.find'],'] ] f','a key removed on purpose does not come back');
 assert.equal(migrateKeymap({...v2,__version:2},[{key:'v',label:'Verify',snippet:'verify',mode:'send'}],true)['activity.cycle'],'');
 // Nothing saved: the defaults.
 assert.deepEqual(migrateKeymap(null,[],true),keyboardPreset('vim',true));});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globalLogin, homeOffers, isLogin, matchRepository, placeFor, placeLabel, runsAtOnce, type HomeRepository } from '../packages/surfaces/src/home-run';

const repositories: HomeRepository[] = [
  { repositoryId: 'github-1', name: 'api', identity: 'github:acme/api', home: '/u/lazybox/repos/acme/api' },
  { repositoryId: 'github-2', name: 'web', identity: 'github:acme/web', home: '' },
];

test('the briefing’s words name the place for certain', () => {
  const offers = homeOffers([
    'Done. To try it, run in the home checkout of api: `make playground`, and `make stop` when done.',
    'Then run in your home folder: `gcloud auth application-default login`',
  ].join('\n'));
  assert.deepEqual(offers, [
    { command: 'make playground', target: { kind: 'repository', repository: 'api' }, explicit: true },
    { command: 'gcloud auth application-default login', target: { kind: 'user' }, explicit: true },
  ]);
  assert.deepEqual(homeOffers('Run in the **acme/web** home: `npm run dev`')[0].target, { kind: 'repository', repository: 'acme/web' });
});

test('a command handed to the person is offered; one the agent ran is not', () => {
  const offers = homeOffers([
    'I ran `go test ./...` and it passes.',
    'Run `acme login` first — I cannot sign in for you.',
    'To run it yourself, use `make playground` from the parser module and `make stop` when done.',
  ].join('\n'));
  assert.deepEqual(offers.map(o => [o.command, o.target.kind, o.explicit]), [
    ['acme login', 'any', false],
    ['make playground', 'any', false],
  ]);
  assert.deepEqual(homeOffers('The tests pass: `npm test` is green, and `make lint` too.'), [], 'nothing handed back, nothing offered');
});

test('a fenced block after a hand-off sentence is one offer', () => {
  const text = 'You will need to run this on your machine:\n\n```sh\ngcloud auth login\ngcloud config set project demo\n```\n';
  const [offer] = homeOffers(text);
  assert.equal(offer.command, 'gcloud auth login\ngcloud config set project demo');
  assert.equal(offer.target.kind, 'user', 'a global login goes to the home folder');
  assert.equal(runsAtOnce(offer.command, []), false, 'a script is typed for review');
  assert.deepEqual(homeOffers('```sh\nmake build\n```'), [], 'a block nobody handed over');
});

test('logins: which are the person’s, which belong to no repository', () => {
  assert.ok(isLogin('acme login'));
  assert.ok(isLogin('gcloud auth application-default login'));
  assert.ok(isLogin('aws sso login --profile dev'));
  assert.ok(!isLogin('make loginpage'));
  assert.ok(globalLogin('gh auth login') && globalLogin('gcloud auth login'));
  assert.ok(!globalLogin('acme login'), 'an unknown tool’s login may be the repository’s');
  assert.deepEqual(homeOffers('Please sign in: `gh auth login`')[0].target, { kind: 'user' });
});

test('at most three, no repeats', () => {
  const text = ['Run `acme login` yourself.', 'Run `acme login` yourself again.', 'You need to run `make a`.', 'You need to run `make b`.', 'You need to run `make c`.'].join('\n');
  assert.deepEqual(homeOffers(text).map(o => o.command), ['acme login', 'make a', 'make b']);
});

test('where an offer runs', () => {
  assert.equal(matchRepository(repositories, 'ACME/API')?.repositoryId, 'github-1');
  assert.equal(matchRepository(repositories, 'web')?.repositoryId, 'github-2');
  assert.equal(matchRepository(repositories, 'billing'), undefined);
  assert.equal(placeLabel(placeFor({ kind: 'repository', repository: 'api' }, repositories)), 'Run in api home');
  assert.equal(placeLabel(placeFor({ kind: 'user' }, repositories)), 'Run in your home folder');
  assert.deepEqual(placeFor({ kind: 'repository', repository: 'billing' }, repositories), { kind: 'unknown', name: 'billing' });
  // Wherever fits: the first repository with a home, else the first repository, else the home folder.
  assert.equal(placeLabel(placeFor({ kind: 'any' }, repositories)), 'Run in api home');
  assert.equal(placeLabel(placeFor({ kind: 'any' }, [repositories[1]])), 'Run in web home');
  assert.equal(placeLabel(placeFor({ kind: 'any' }, [])), 'Run in your home folder');
  assert.ok(runsAtOnce('acme login', []));
  assert.ok(!runsAtOnce('acme login --token <your-token>', ['<your-token>']));
});

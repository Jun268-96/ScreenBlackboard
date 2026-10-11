const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const tests = String.raw`
(async () => {
  const results = [];
  const assert = (name, condition, detail) => {
    results.push({ name, ok: Boolean(condition), detail: condition ? '' : String(detail || '') });
  };

  const board = document.getElementById('board');
  const formatter = new SimpleTextFormatter();

  const selectAll = () => {
    const range = document.createRange();
    range.selectNodeContents(board);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  };

  const placeCaretAtEnd = () => {
    const range = document.createRange();
    range.selectNodeContents(board);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  board.innerHTML = '';
  board.textContent = '안녕';
  selectAll();
  formatter.setFontSize(board, 72);
  selectAll();
  formatter.setFontSize(board, 48);
  const sizes = [...board.querySelectorAll('span')]
    .map((span) => span.style.fontSize)
    .filter(Boolean);
  const computed = window.getComputedStyle(board.querySelector('span') || board).fontSize;
  assert('nested size applies 48px', computed === '48px', computed + ' spans=' + JSON.stringify(sizes));
  assert('no leftover inner 72px span', !sizes.includes('72px'), JSON.stringify(sizes));

  board.innerHTML = '<span style="font-weight: bold">굵게</span>';
  const rangeBold = document.createRange();
  rangeBold.selectNodeContents(board.querySelector('span'));
  const selBold = window.getSelection();
  selBold.removeAllRanges();
  selBold.addRange(rangeBold);
  const before = formatter.getCurrentFormat(board);
  assert('bold reads as bold from 700/bold', before.fontWeight === 'bold', before.fontWeight);
  formatter.toggleFormat(board, 'fontWeight');
  const after = formatter.getCurrentFormat(board);
  assert('bold toggle turns off', after.fontWeight === 'normal', after.fontWeight);

  board.innerHTML = '<span style="text-decoration: underline">밑줄</span>';
  const rangeU = document.createRange();
  rangeU.selectNodeContents(board.querySelector('span'));
  const selU = window.getSelection();
  selU.removeAllRanges();
  selU.addRange(rangeU);
  const uBefore = formatter.getCurrentFormat(board);
  assert('underline detected from computed style', uBefore.textDecoration === 'underline', uBefore.textDecoration);
  formatter.toggleFormat(board, 'textDecoration');
  const uAfter = formatter.getCurrentFormat(board);
  assert('underline toggle turns off', uAfter.textDecoration === 'none', uAfter.textDecoration);

  board.innerHTML = '<span style="font-size: 72px">기존글</span>';
  board.style.fontSize = '72px';
  placeCaretAtEnd();
  formatter.setFontSize(board, 24);
  const oldSpan = board.querySelector('span');
  const oldSize = oldSpan ? window.getComputedStyle(oldSpan).fontSize : 'missing';
  assert('caret-only size change keeps existing 72px text', oldSize === '72px', oldSize);
  assert('board dataset stores typing size 24', JSON.parse(board.dataset.currentFormat || '{}').fontSize === 24, board.dataset.currentFormat);

  board.innerHTML = '';
  formatter.setFontSize(board, 36);
  assert('empty board can take default 36px', board.style.fontSize === '36px', board.style.fontSize);

  assert('weight 700 is bold', formatter.normalizeFontWeight('700') === 'bold');
  assert('weight 400 is normal', formatter.normalizeFontWeight('400') === 'normal');
  assert('underline solid rgb is underline', formatter.normalizeTextDecoration('underline solid rgb(255, 255, 255)') === 'underline');
  assert('rgbToHex white', formatter.rgbToHex('rgb(255, 255, 255)') === '#ffffff');

  board.innerHTML = '<span style="font-size: 48px">작은</span> <span style="font-size: 72px">큰</span>';
  board.style.fontSize = '72px';
  const stepUp = (size) => {
    const steps = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 84, 96, 112, 128, 144, 160, 180, 200];
    return steps.find((value) => value > size) || steps[steps.length - 1];
  };
  board.querySelectorAll('span').forEach((span) => {
    const current = parseInt(span.style.fontSize, 10);
    span.style.fontSize = stepUp(current) + 'px';
  });
  board.style.fontSize = stepUp(72) + 'px';
  const zoomed = [...board.querySelectorAll('span')].map((span) => span.style.fontSize);
  assert('zoom steps mixed text independently', zoomed[0] === '56px' && zoomed[1] === '84px', JSON.stringify(zoomed));
  assert('zoom does not use css transform on board', board.style.transform === '' || board.style.transform === 'none', board.style.transform);

  return results;
})()
`;

async function run() {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, 'smoke-test.html'));
  const results = await win.webContents.executeJavaScript(tests, true);
  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});

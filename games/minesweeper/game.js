(() => {
  'use strict';

  const levels = {
    beginner: { columns: 9, rows: 9, mines: 10 },
    intermediate: { columns: 16, rows: 16, mines: 40 },
    expert: { columns: 30, rows: 16, mines: 99 },
  };
  const messages = {
    ready: '选一个格子开始',
    playing: '排雷中',
    won: '排雷成功！',
    lost: '踩到地雷了',
  };
  const board = document.querySelector('#board');
  const status = document.querySelector('#status');
  const minesLeft = document.querySelector('#mines-left');
  const elapsed = document.querySelector('#elapsed');
  const levelButtons = document.querySelectorAll('[data-level]');
  const modeButtons = document.querySelectorAll('[data-mode]');

  let level = 'beginner';
  let mode = 'reveal';
  let cells;
  let buttons;
  let state;
  let opened;
  let flags;
  let hit;
  let focusIndex;
  let startedAt;
  let timer;

  function updateTime() {
    const seconds = Math.floor((performance.now() - startedAt) / 1000);
    elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function setMode(value) {
    mode = value;
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
  }

  function render() {
    const { columns, mines } = levels[level];
    const finished = state === 'won' || state === 'lost';
    minesLeft.textContent = state === 'won' ? 0 : mines - flags;
    status.dataset.state = state;
    if (status.textContent !== messages[state]) status.textContent = messages[state];

    cells.forEach((cell, index) => {
      const button = buttons[index];
      const showMine = state === 'lost' && cell.mine && !cell.flagged;
      const wrongFlag = state === 'lost' && cell.flagged && !cell.mine;
      const showFlag = cell.flagged || (state === 'won' && cell.mine);
      const number = cell.open && cell.count > 0 ? cell.count : '';
      button.classList.toggle('open', cell.open);
      button.classList.toggle('flag', showFlag);
      button.classList.toggle('mine', showMine);
      button.classList.toggle('hit', index === hit);
      button.classList.toggle('wrong', wrongFlag);
      button.dataset.number = number;
      button.textContent = wrongFlag ? '×' : showMine ? '✹' : showFlag ? '⚑' : number;
      button.setAttribute('aria-disabled', String(finished));
      const label = index === hit ? '踩中的地雷' : wrongFlag ? '插旗错误' : showMine ? '地雷' :
        showFlag ? '已插旗' : cell.open ? (number ? `周围 ${number} 雷` : '空格') : '未翻开';
      button.setAttribute('aria-label', `第 ${Math.floor(index / columns) + 1} 行第 ${index % columns + 1} 列，${label}`);
    });
  }

  function newGame() {
    const { columns, rows } = levels[level];
    clearInterval(timer);
    elapsed.textContent = '00:00';
    state = 'ready';
    opened = 0;
    flags = 0;
    hit = -1;
    focusIndex = 0;
    setMode('reveal');
    for (const button of levelButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.level === level));
    }
    board.dataset.level = level;
    board.style.setProperty('--columns', columns);
    cells = Array.from({ length: columns * rows }, (_, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const neighbors = [];
      for (let y = Math.max(0, row - 1); y <= Math.min(rows - 1, row + 1); y++) {
        for (let x = Math.max(0, column - 1); x <= Math.min(columns - 1, column + 1); x++) {
          const neighbor = y * columns + x;
          if (neighbor !== index) neighbors.push(neighbor);
        }
      }
      return { mine: false, open: false, flagged: false, count: 0, neighbors };
    });
    buttons = cells.map((_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tile';
      button.dataset.index = index;
      button.tabIndex = index === focusIndex ? 0 : -1;
      return button;
    });
    board.replaceChildren(...buttons);
    board.parentElement.scrollLeft = 0;
    render();
  }

  function start(first) {
    const safeZone = new Set([first, ...cells[first].neighbors]);
    const candidates = Array.from(cells.keys()).filter(index => !safeZone.has(index));
    for (let i = 0; i < levels[level].mines; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      cells[candidates[i]].mine = true;
    }
    for (const cell of cells) {
      cell.count = cell.neighbors.filter(index => cells[index].mine).length;
    }
    startedAt = performance.now();
    timer = setInterval(updateTime, 200);
    state = 'playing';
  }

  function reveal(indices) {
    const queue = [...indices];
    while (queue.length) {
      const index = queue.pop();
      const cell = cells[index];
      if (cell.open || cell.flagged) continue;
      if (cell.mine) {
        hit = index;
        state = 'lost';
        break;
      }
      cell.open = true;
      opened++;
      if (cell.count === 0) queue.push(...cell.neighbors);
    }
    if (opened === cells.length - levels[level].mines) state = 'won';
    if (state === 'won' || state === 'lost') {
      clearInterval(timer);
      updateTime();
    }
  }

  function play(index, action) {
    if (state === 'won' || state === 'lost') return;
    const cell = cells[index];
    if (action === 'flag') {
      if (cell.open) return;
      cell.flagged = !cell.flagged;
      flags += cell.flagged ? 1 : -1;
    } else if (!cell.flagged) {
      if (cell.open) {
        if (!cell.count || cell.neighbors.filter(neighbor => cells[neighbor].flagged).length !== cell.count) return;
        reveal(cell.neighbors);
      } else {
        if (state === 'ready') start(index);
        reveal([index]);
      }
    } else {
      return;
    }
    render();
  }

  board.addEventListener('click', event => {
    const tile = event.target.closest('.tile');
    if (tile) play(Number(tile.dataset.index), mode);
  });
  board.addEventListener('contextmenu', event => {
    const tile = event.target.closest('.tile');
    if (!tile) return;
    event.preventDefault();
    play(Number(tile.dataset.index), 'flag');
  });
  board.addEventListener('focusin', event => {
    const tile = event.target.closest('.tile');
    if (!tile) return;
    buttons[focusIndex].tabIndex = -1;
    tile.tabIndex = 0;
    focusIndex = Number(tile.dataset.index);
  });
  board.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!event.repeat) play(focusIndex, 'flag');
      return;
    }
    const { columns } = levels[level];
    let next = focusIndex;
    switch (event.key) {
      case 'ArrowLeft': if (focusIndex % columns > 0) next--; break;
      case 'ArrowRight': if (focusIndex % columns < columns - 1) next++; break;
      case 'ArrowUp': if (focusIndex >= columns) next -= columns; break;
      case 'ArrowDown': if (focusIndex + columns < cells.length) next += columns; break;
      default: return;
    }
    event.preventDefault();
    buttons[next].focus();
  });
  document.querySelector('#restart').addEventListener('click', newGame);
  for (const button of levelButtons) {
    button.addEventListener('click', () => {
      if (level === button.dataset.level) return;
      level = button.dataset.level;
      newGame();
    });
  }
  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  }
  newGame();
})();

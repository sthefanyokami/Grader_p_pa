(() => {
  'use strict';

  const STORAGE_KEY = 'grader-web-state-v5';
  const SCALE = {
    1: { id: 1, title: 'Base 7 (0-7)', max: 7, min: 4 },
    2: { id: 2, title: 'Base 10 (0-10)', max: 10, min: 4 },
    3: { id: 3, title: 'Base 20 (0-20)', max: 20, min: 9.5 },
    4: { id: 4, title: 'Base 100 (0-100)', max: 100, min: 50 }
  };

  const DEFAULT_STATE = {
    version: 5,
    config: {
      typeGradeId: 2,
      minToPass: null,
      directPercentage: false,
      roundFinal: false,
      theme: 'system'
    },
    courses: [],
    grades: [],
    semesters: [],
    nextId: { course: 1, grade: 1, semester: 1, subgrade: 1 }
  };

  let state = loadState();
  let page = { name: 'home', id: null };
  let modal = null;

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return deepClone(DEFAULT_STATE);
      return normalizeState(saved);
    } catch (_) {
      return deepClone(DEFAULT_STATE);
    }
  }

  function normalizeState(saved) {
    const s = deepClone(DEFAULT_STATE);
    s.config = { ...s.config, ...(saved.config || {}) };
    s.courses = Array.isArray(saved.courses) ? saved.courses : [];
    s.grades = Array.isArray(saved.grades) ? saved.grades : [];
    s.semesters = Array.isArray(saved.semesters) ? saved.semesters : [];
    s.nextId = { ...s.nextId, ...(saved.nextId || {}) };

    for (const c of s.courses) {
      c.id = Number(c.id);
      c.uc = Number(c.uc);
      c.typeGradeId = Number(c.typeGradeId || s.config.typeGradeId || 2);
      c.semesterId = c.semesterId == null || c.semesterId === '' ? null : Number(c.semesterId);
      if (!Number.isFinite(c.uc)) c.uc = 1;
    }
    for (const g of s.grades) {
      g.id = Number(g.id);
      g.courseId = Number(g.courseId);
      g.weight = Number(g.weight);
      g.value = g.value === '' || g.value == null ? null : Number(g.value);
      g.title = g.title || 'Sin título';
      g.description = g.description || 'Sin descripción';
      g.subgrades = Array.isArray(g.subgrades) ? g.subgrades : [];
      for (const sub of g.subgrades) {
        sub.id = Number(sub.id);
        sub.value = sub.value === '' || sub.value == null ? null : Number(sub.value);
      }
    }
    for (const s2 of s.semesters) s2.id = Number(s2.id);
    return s;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function nextId(type) {
    const id = Number(state.nextId[type] || 1);
    state.nextId[type] = id + 1;
    return id;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function num(value) {
    const n = Number(String(value ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  function fmt(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    const n = Math.round(Number(value) * 100) / 100;
    return Number.isInteger(n) ? String(n) : String(n);
  }

  function scaleForCourse(course) {
    return SCALE[Number(course?.typeGradeId)] || SCALE[Number(state.config.typeGradeId)] || SCALE[2];
  }

  function courseById(id) {
    return state.courses.find(c => c.id === Number(id)) || null;
  }

  function gradeById(id) {
    return state.grades.find(g => g.id === Number(id)) || null;
  }

  function gradesForCourse(courseId) {
    return state.grades.filter(g => g.courseId === Number(courseId));
  }

  function semesterById(id) {
    return state.semesters.find(s => s.id === Number(id)) || null;
  }

  function gradePercent(grade, course) {
    if (grade.value == null) return null;
    if (state.config.directPercentage) {
      return grade.weight > 0 ? (grade.value / grade.weight) * 100 : null;
    }
    const scale = scaleForCourse(course);
    return (grade.value / scale.max) * 100;
  }

  function gradeContribution(grade, course) {
    const p = gradePercent(grade, course);
    return p == null ? 0 : (p * grade.weight) / 100;
  }

  function courseStats(course) {
    const grades = gradesForCourse(course.id);
    const totalWeight = grades.reduce((sum, g) => sum + (Number.isFinite(g.weight) ? g.weight : 0), 0);
    const evaluated = grades.reduce((sum, g) => sum + gradeContribution(g, course), 0);
    return {
      totalWeight: Math.min(100, totalWeight),
      evaluated,
      remaining: Math.max(0, 100 - totalWeight)
    };
  }

  function courseAverage(course) {
    const stats = courseStats(course);
    if (stats.totalWeight <= 0) return null;
    if (state.config.directPercentage) return stats.evaluated;
    const scale = scaleForCourse(course);
    return (stats.evaluated / 100) * scale.max;
  }

  function minimumToPass(course) {
    const scale = scaleForCourse(course);
    return state.config.minToPass == null ? scale.min : Number(state.config.minToPass);
  }

  function semesterAverage(semesterId) {
    const courses = state.courses.filter(c => c.semesterId === Number(semesterId));
    let totalUc = 0, total = 0;
    for (const c of courses) {
      const avg = courseAverage(c);
      if (avg == null) continue;
      totalUc += c.uc;
      total += avg * c.uc;
    }
    return totalUc ? total / totalUc : null;
  }

  function currentCourses() {
    return state.courses.filter(c => c.semesterId == null);
  }

  function currentAverage() {
    const courses = currentCourses();
    let totalUc = 0, total = 0;
    for (const c of courses) {
      const avg = courseAverage(c);
      if (avg == null) continue;
      totalUc += c.uc;
      total += avg * c.uc;
    }
    return totalUc ? total / totalUc : null;
  }

  function allCoursesAverage() {
    const courses = state.courses;
    let totalUc = 0, total = 0;
    for (const c of courses) {
      const avg = courseAverage(c);
      if (avg == null) continue;
      totalUc += c.uc;
      total += avg * c.uc;
    }
    return totalUc ? total / totalUc : null;
  }

  function navigate(name, id = null) {
    page = { name, id };
    closeModal();
    render();
    window.scrollTo(0, 0);
  }

  function applyTheme() {
    let theme = state.config.theme;
    if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
  }

  function layout(title, content, active) {
    return `
      <header class="topbar">
        <button class="icon-btn" data-action="menu" aria-label="Menú">☰</button>
        <h1>${esc(title)}</h1>
        <button class="icon-btn" data-nav="config" aria-label="Ajustes">⚙</button>
      </header>
      <main class="content">${content}</main>
      <nav class="bottom-nav">
        <button class="nav-btn ${active === 'home' ? 'active' : ''}" data-nav="home">⌂<span>Asignaturas</span></button>
        <button class="nav-btn ${active === 'grades' ? 'active' : ''}" data-nav="grades">★<span>Calificaciones</span></button>
        <button class="nav-btn ${active === 'record' ? 'active' : ''}" data-nav="record">▤<span>Registro</span></button>
        <button class="nav-btn ${active === 'config' ? 'active' : ''}" data-nav="config">⚙<span>Ajustes</span></button>
      </nav>`;
  }

  function statCard(title, value, subtitle) {
    return `<section class="stat-card"><div><div class="eyebrow">${esc(title)}</div><div class="stat-value">${esc(value)}</div><div class="muted">${esc(subtitle)}</div></div></section>`;
  }

  function courseCard(course) {
    const stats = courseStats(course);
    const avg = courseAverage(course);
    const scale = scaleForCourse(course);
    const status = avg == null ? 'pending' : avg < minimumToPass(course) ? 'fail' : stats.totalWeight >= 100 ? 'done' : 'pass';
    return `
      <article class="card course-card" data-open-course="${course.id}">
        <div class="row">
          <div class="avatar">🎓</div>
          <div class="grow">
            <h3>${esc(course.title || 'Sin título')}</h3>
            <p class="muted">${fmt(course.uc)} Peso · ${fmt(stats.totalWeight)}% evaluado</p>
          </div>
          <div class="course-average ${status}">${avg == null ? '—' : fmt(avg)}<small>/${scale.max}</small></div>
        </div>
        <div class="progress"><i style="width:${Math.min(100, stats.totalWeight)}%"></i></div>
        <div class="card-meta"><span>${gradesForCourse(course.id).length} ${gradesForCourse(course.id).length === 1 ? 'evaluación' : 'evaluaciones'}</span><span>${stats.remaining ? fmt(stats.remaining) + '% pendiente' : 'Completada'}</span></div>
        <div class="card-actions">
          <button data-edit-course="${course.id}">Editar</button>
          <button class="danger" data-delete-course="${course.id}">Eliminar</button>
        </div>
      </article>`;
  }

  function homePage() {
    const courses = currentCourses();
    const avg = currentAverage();
    const scale = SCALE[state.config.typeGradeId] || SCALE[2];
    return layout('Asignaturas', `
      ${statCard('Promedio actual', avg == null ? '—' : fmt(avg), `${courses.length} ${courses.length === 1 ? 'asignatura' : 'asignaturas'} · ${courses.reduce((s,c) => s + c.uc, 0)} Peso`)}
      <div class="section-head"><div><h2>Registro actual</h2><p class="muted">Estas son las asignaturas que todavía no están guardadas en un semestre.</p></div><button class="small-primary" data-add-course>＋ Asignatura</button></div>
      <div class="grid">${courses.length ? courses.map(courseCard).join('') : `<div class="empty"><div class="empty-icon">🎓</div><h3>Registro actual vacío</h3><p>Agrega una asignatura para empezar a registrar tus evaluaciones.</p><button class="primary" data-add-course>Agregar asignatura</button></div>`}</div>
      ${courses.length ? `<div class="tip">La calificación se agrega entrando a una asignatura y pulsando <b>＋ Evaluación</b>. El porcentaje es la ponderación de esa evaluación.</div>` : ''}
    `, 'home');
  }

  function coursePage(courseId) {
    const course = courseById(courseId);
    if (!course) return homePage();
    const stats = courseStats(course);
    const avg = courseAverage(course);
    const scale = scaleForCourse(course);
    const grades = gradesForCourse(course.id);
    return layout(course.title || 'Asignatura', `
      <button class="back" data-nav="home">← Volver a asignaturas</button>
      <section class="hero-card">
        <div><div class="eyebrow">Promedio</div><div class="hero-value">${avg == null ? '—' : fmt(avg)} <small>/${scale.max}</small></div><div class="muted">${fmt(stats.totalWeight)}% evaluado · ${fmt(course.uc)} Peso</div></div>
        <div class="hero-ring"><span>${fmt(stats.evaluated)}%</span></div>
      </section>
      <div class="three-stats"><div><b>${fmt(stats.evaluated)}</b><span>Puntos acumulados</span></div><div><b>${fmt(stats.remaining)}</b><span>Puntos pendientes</span></div><div><b>${fmt(stats.totalWeight)}%</b><span>Evaluado</span></div></div>
      <div class="section-head"><div><h2>Evaluaciones</h2><p class="muted">Asigna una nota y la ponderación de cada evaluación.</p></div><button class="small-primary" data-add-grade="${course.id}">＋ Evaluación</button></div>
      <div class="stack">${grades.length ? grades.map(g => gradeCard(g, course)).join('') : `<div class="empty compact"><h3>Aún no hay evaluaciones</h3><p>Agrega la primera evaluación con su nota y porcentaje.</p><button class="primary" data-add-grade="${course.id}">Agregar evaluación</button></div>`}</div>
      <div class="card settings-card"><h3>Asignatura</h3><p class="muted">Escala: ${esc(scale.title)} · Mínimo para aprobar: ${fmt(minimumToPass(course))}</p><div class="card-actions"><button data-edit-course="${course.id}">Editar asignatura</button><button class="danger" data-delete-course="${course.id}">Eliminar asignatura</button></div></div>
    `, 'home');
  }

  function gradeCard(grade, course) {
    const p = gradePercent(grade, course);
    const value = grade.value == null ? '—' : fmt(grade.value);
    return `<article class="card grade-card" data-open-grade="${grade.id}">
      <div class="row"><div class="avatar star">★</div><div class="grow"><h3>${esc(grade.title || 'Sin título')}</h3><p class="muted">${esc(grade.description || 'Sin descripción')}</p></div><div class="grade-value">${value}<small>${p == null ? '' : `(${fmt(p)}%)`}</small></div></div>
      <div class="weight-line"><span>Ponderación</span><b>${fmt(grade.weight)}%</b></div>
      ${grade.subgrades?.length ? `<div class="sub-summary">${grade.subgrades.length} subcalificaciones</div>` : ''}
      <div class="card-actions"><button data-edit-grade="${grade.id}">Editar</button><button class="danger" data-delete-grade="${grade.id}">Eliminar</button></div>
    </article>`;
  }

  function gradesPage() {
    const courses = state.courses.filter(c => gradesForCourse(c.id).length);
    return layout('Calificaciones', courses.length ? courses.map(c => `<section class="grade-group"><button class="course-link" data-open-course="${c.id}">${esc(c.title)} <span>›</span></button>${gradesForCourse(c.id).map(g => gradeCard(g,c)).join('')}</section>`).join('') : `<div class="empty"><div class="empty-icon">★</div><h3>Aún no hay evaluaciones</h3><p>Agrega una evaluación desde una asignatura.</p></div>`, 'grades');
  }

  function recordPage() {
    const current = currentCourses();
    const semesters = [...state.semesters];
    return layout('Registro académico', `
      <section class="record-overview">${statCard('Promedio del registro actual', currentAverage() == null ? '—' : fmt(currentAverage()), `${current.length} asignaturas pendientes de guardar`)}</section>
      <section class="card current-record"><div class="section-head"><div><h2>Registro actual</h2><p class="muted">Aquí están las asignaturas que aún no pertenecen a un semestre.</p></div><button class="small-primary" data-add-course>＋</button></div>
        ${current.length ? current.map(c => `<div class="record-course"><button class="record-course-main" data-open-course="${c.id}"><span>${esc(c.title)}</span><small>${fmt(c.uc)} Peso · ${courseAverage(c)==null?'—':fmt(courseAverage(c))}</small></button><button class="dots" data-record-course="${c.id}">⋮</button></div>`).join('') : `<div class="empty mini"><p>No hay asignaturas en el registro actual.</p><button class="primary" data-add-course>Agregar asignatura</button></div>`}
        ${current.length ? `<button class="primary full" data-save-current>Guardar registro actual como semestre</button>` : ''}
      </section>
      <div class="section-head"><div><h2>Semestres guardados</h2><p class="muted">Los registros que ya organizaste por período.</p></div><button class="small-primary" data-add-semester>＋ Semestre</button></div>
      <div class="stack">${semesters.length ? semesters.map(semesterCard).join('') : `<div class="empty compact"><h3>No hay semestres guardados</h3><p>Cuando termines un período, guárdalo aquí.</p></div>`}</div>
      <section class="card"><h3>Promedio total</h3><div class="big-inline">${allCoursesAverage() == null ? '—' : fmt(allCoursesAverage())}</div><p class="muted">Se calcula con todas las asignaturas que tienen promedio, ponderadas por Peso.</p></section>
    `, 'record');
  }

  function semesterCard(semester) {
    const courses = state.courses.filter(c => c.semesterId === semester.id);
    const avg = semesterAverage(semester.id);
    return `<article class="card semester-card"><div class="row"><div class="grow"><h3>${esc(semester.title)}</h3><p class="muted">${courses.length} ${courses.length === 1 ? 'asignatura' : 'asignaturas'} · ${courses.reduce((s,c)=>s+c.uc,0)} Peso</p></div><div class="semester-average">${avg == null ? '—' : fmt(avg)}</div></div><div class="card-actions"><button data-open-sem="${semester.id}">Ver</button><button data-edit-sem="${semester.id}">Editar</button><button class="danger" data-delete-sem="${semester.id}">Eliminar</button></div></article>`;
  }

  function semesterPage(id) {
    const semester = semesterById(id);
    if (!semester) return recordPage();
    const courses = state.courses.filter(c => c.semesterId === semester.id);
    return layout(semester.title, `
      <button class="back" data-nav="record">← Volver al registro</button>
      ${statCard('Promedio del semestre', semesterAverage(id) == null ? '—' : fmt(semesterAverage(id)), `${courses.length} asignaturas · ${courses.reduce((s,c)=>s+c.uc,0)} Peso`)}
      <div class="section-head"><div><h2>Asignaturas</h2></div><button class="small-primary" data-add-course data-semester="${semester.id}">＋ Asignatura</button></div>
      <div class="grid">${courses.length ? courses.map(courseCard).join('') : `<div class="empty compact"><h3>Semestre vacío</h3><p>Agrega asignaturas a este semestre.</p></div>`}</div>
      <section class="card"><div class="card-actions"><button data-transfer-sem="${semester.id}">Mover asignaturas al registro actual</button><button class="danger" data-delete-sem="${semester.id}">Eliminar semestre</button></div></section>
    `, 'record');
  }

  function configPage() {
    return layout('Ajustes', `
      <section class="card form-card"><h2>Configuración</h2>
        <label>Tipo de calificación<select id="cfg-scale">${Object.values(SCALE).map(s => `<option value="${s.id}" ${Number(state.config.typeGradeId)===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label>
        <label>Mínimo para aprobar (opcional)<input id="cfg-min" type="text" inputmode="decimal" value="${state.config.minToPass == null ? '' : esc(fmt(state.config.minToPass))}" placeholder="Usar mínimo de la escala"></label>
        <label class="check"><input id="cfg-direct" type="checkbox" ${state.config.directPercentage?'checked':''}> Usar porcentaje acumulativo como calificación</label>
        <label class="check"><input id="cfg-round" type="checkbox" ${state.config.roundFinal?'checked':''}> Redondear promedio para asignaturas finalizadas</label>
        <label>Tema<select id="cfg-theme"><option value="system" ${state.config.theme==='system'?'selected':''}>Usar tema del sistema</option><option value="light" ${state.config.theme==='light'?'selected':''}>Tema claro</option><option value="dark" ${state.config.theme==='dark'?'selected':''}>Tema oscuro</option></select></label>
      </section>
      <section class="card form-card"><h2>Datos</h2><div class="card-actions vertical"><button data-export>Exportar registro</button><label class="file-btn">Importar registro<input id="import-file" type="file" accept="application/json"></label><button class="danger" data-reset>Eliminar todos los datos</button></div></section>
      <section class="tip"><b>Guardado automático.</b> Tus datos se guardan en este navegador. Usa Exportar registro para tener una copia de respaldo.</section>
    `, 'config');
  }

  function modalHtml(title, body, actions) {
    return `<div class="modal-backdrop" data-modal><div class="modal"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close-modal>×</button></div>${body}<div class="modal-actions">${actions}</div></div></div>`;
  }

  function openCourseModal(courseId = null, semesterId = null) {
    const course = courseId == null ? null : courseById(courseId);
    modal = { type: 'course', id: courseId, semesterId };
    document.body.insertAdjacentHTML('beforeend', modalHtml(course ? 'Editar asignatura' : 'Asignatura', `
      <div class="form-grid"><label>Nombre<input id="m-course-title" maxlength="50" value="${esc(course?.title || '')}" placeholder="Sin título"></label>
      <label>Peso<input id="m-course-uc" type="text" inputmode="numeric" value="${course?.uc ?? 1}" placeholder="1"></label>
      <label>Escala<select id="m-course-scale">${Object.values(SCALE).map(s => `<option value="${s.id}" ${Number(course?.typeGradeId ?? state.config.typeGradeId)===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label></div>
      <div id="course-error" class="error-box hidden"></div>
    `, `<button data-close-modal>Cancelar</button><button class="primary" data-save-course>${course ? 'Guardar' : 'Crear'}</button>`));
    bindModal();
  }

  function remainingWeight(courseId, excludedGradeId = null) {
    return Math.max(0, 100 - gradesForCourse(courseId).filter(g => g.id !== Number(excludedGradeId)).reduce((s,g)=>s+g.weight,0));
  }

  function openGradeModal(gradeId = null, courseId = null) {
    const grade = gradeId == null ? null : gradeById(gradeId);
    const selectedCourse = courseId != null ? courseById(courseId) : grade ? courseById(grade.courseId) : state.courses[0];
    if (!selectedCourse) {
      showMessage('Primero agrega una asignatura.');
      return;
    }
    modal = { type: 'grade', id: gradeId };
    const selectedId = selectedCourse.id;
    const scale = scaleForCourse(selectedCourse);
    const defaultWeight = grade ? grade.weight : remainingWeight(selectedId);
    const gradeMax = state.config.directPercentage ? defaultWeight : scale.max;
    const subs = !state.config.directPercentage && grade?.subgrades?.length ? grade.subgrades : [];

    document.body.insertAdjacentHTML('beforeend', modalHtml(grade ? 'Editar evaluación' : 'Evaluación', `
      <div class="form-grid">
        <label>Asignatura<select id="m-grade-course">${state.courses.map(c => `<option value="${c.id}" ${c.id===selectedId?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label>
        <label>Nota <span class="field-help" id="grade-max-help">0-${fmt(gradeMax)}</span><input id="m-grade-value" type="text" inputmode="decimal" value="${grade?.value == null ? '' : esc(fmt(grade.value))}" placeholder="0-${fmt(gradeMax)}"><small id="grade-hint">Puedes dejarla vacía si todavía no tienes la nota.</small></label>
        <label>Porcentaje de esta evaluación<input id="m-grade-weight" type="text" inputmode="decimal" value="${fmt(defaultWeight)}" placeholder="${fmt(defaultWeight)}"><small id="weight-hint">Queda disponible ${fmt(defaultWeight)}% para esta asignatura.</small></label>
        <label>Título (opcional)<input id="m-grade-title" maxlength="50" value="${esc(grade?.title || '')}" placeholder="Ej. Parcial 1"></label>
        <label>Descripción (opcional)<textarea id="m-grade-desc" rows="3" placeholder="Descripción">${esc(grade?.description === 'Sin descripción' ? '' : grade?.description || '')}</textarea></label>
      </div>
      <div id="subgrade-section" class="subgrade-section ${state.config.directPercentage ? 'hidden' : ''}"><div class="section-head"><div><h3>Subcalificaciones</h3><p class="muted">Si las usas, la nota de la evaluación será su promedio.</p></div><button type="button" class="small-primary" data-add-sub>＋</button></div><div id="subgrade-list"></div></div>
      <div id="grade-error" class="error-box hidden"></div>
    `, `<button data-close-modal>Cancelar</button><button class="primary" data-save-grade>${grade ? 'Guardar' : 'Crear evaluación'}</button>`));
    const list = document.getElementById('subgrade-list');
    for (const sub of subs) addSubRow(list, sub.title, sub.value);
    bindModal();
    updateGradeFormForCourse();
  }

  function addSubRow(list, title = '', value = null) {
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'sub-row';
    row.innerHTML = `<input class="sub-title" maxlength="50" value="${esc(title)}" placeholder="Subcalificación"><input class="sub-value" type="text" inputmode="decimal" value="${value == null ? '' : esc(fmt(value))}" placeholder="Nota"><button type="button" class="remove-sub">×</button>`;
    row.querySelector('.remove-sub').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  function updateGradeFormForCourse() {
    const select = document.getElementById('m-grade-course');
    if (!select) return;
    const course = courseById(select.value);
    if (!course) return;
    const gradeId = modal?.id;
    const oldGrade = gradeId == null ? null : gradeById(gradeId);
    const scale = scaleForCourse(course);
    const remaining = oldGrade ? remainingWeight(course.id, oldGrade.id) : remainingWeight(course.id);
    const currentWeight = oldGrade ? oldGrade.weight : remaining;
    const max = state.config.directPercentage ? currentWeight : scale.max;
    document.getElementById('grade-max-help').textContent = `0-${fmt(max)}`;
    document.getElementById('m-grade-value').placeholder = `0-${fmt(max)}`;
    document.getElementById('weight-hint').textContent = `Disponible: ${fmt(remaining)}%.`;
    const section = document.getElementById('subgrade-section');
    if (section) section.classList.toggle('hidden', state.config.directPercentage);
  }

  function showModalError(id, message) {
    const box = document.getElementById(id);
    if (!box) return;
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function clearModalError(id) {
    const box = document.getElementById(id);
    if (box) box.classList.add('hidden');
  }

  function closeModal() {
    const el = document.querySelector('[data-modal]');
    if (el) el.remove();
    modal = null;
  }

  function saveCourseFromModal() {
    clearModalError('course-error');
    const title = document.getElementById('m-course-title').value.trim() || 'Sin título';
    const uc = num(document.getElementById('m-course-uc').value);
    const typeGradeId = Number(document.getElementById('m-course-scale').value);
    if (uc == null || uc < 0) return showModalError('course-error', 'El Peso debe ser un número mayor o igual a 0.');
    if (!SCALE[typeGradeId]) return showModalError('course-error', 'Selecciona una escala válida.');

    if (modal.id != null) {
      const course = courseById(modal.id);
      if (!course) return showModalError('course-error', 'La asignatura ya no existe.');
      course.title = title;
      course.uc = uc;
      course.typeGradeId = typeGradeId;
    } else {
      state.courses.push({ id: nextId('course'), title, uc, semesterId: modal.semesterId == null ? null : Number(modal.semesterId), typeGradeId });
    }
    saveState();
    closeModal();
    render();
  }

  function saveGradeFromModal() {
    clearModalError('grade-error');
    const courseId = Number(document.getElementById('m-grade-course').value);
    const course = courseById(courseId);
    if (!course) return showModalError('grade-error', 'Selecciona una asignatura válida.');

    const weightInput = document.getElementById('m-grade-weight').value.trim();
    const weight = weightInput === '' ? remainingWeight(course.id, modal.id) : num(weightInput);
    if (weight == null || weight <= 0 || weight > 100) return showModalError('grade-error', 'El porcentaje debe ser un número mayor que 0 y menor o igual a 100.');

    const otherWeight = gradesForCourse(course.id).filter(g => g.id !== Number(modal.id)).reduce((s,g)=>s+g.weight,0);
    if (otherWeight + weight > 100.000001) return showModalError('grade-error', `No puedes superar el 100%. Ya hay ${fmt(otherWeight)}% asignado y estás intentando agregar ${fmt(weight)}%.`);

    const scale = scaleForCourse(course);
    const max = state.config.directPercentage ? weight : scale.max;
    const valueText = document.getElementById('m-grade-value').value.trim();
    let value = valueText === '' ? null : num(valueText);
    if (value != null && (value < 0 || value > max)) return showModalError('grade-error', `La nota debe estar entre 0 y ${fmt(max)} para esta evaluación.`);

    const subgrades = [];
    if (!state.config.directPercentage) {
      document.querySelectorAll('#subgrade-list .sub-row').forEach(row => {
        const title = row.querySelector('.sub-title').value.trim() || 'Subcalificación';
        const text = row.querySelector('.sub-value').value.trim();
        if (text !== '') subgrades.push({ id: nextId('subgrade'), title, value: num(text) });
      });
      for (const sub of subgrades) {
        if (sub.value == null) return showModalError('grade-error', 'Todas las subcalificaciones que tengan contenido deben tener una nota válida.');
        if (sub.value < 0 || sub.value > scale.max) return showModalError('grade-error', `Cada subcalificación debe estar entre 0 y ${fmt(scale.max)}.`);
      }
      if (subgrades.length) value = subgrades.reduce((sum, s) => sum + s.value, 0) / subgrades.length;
    }

    const title = document.getElementById('m-grade-title').value.trim() || 'Sin título';
    const description = document.getElementById('m-grade-desc').value.trim() || 'Sin descripción';
    if (modal.id != null) {
      const grade = gradeById(modal.id);
      if (!grade) return showModalError('grade-error', 'La evaluación ya no existe.');
      grade.courseId = course.id;
      grade.weight = weight;
      grade.value = value;
      grade.title = title;
      grade.description = description;
      grade.subgrades = subgrades;
    } else {
      state.grades.push({ id: nextId('grade'), courseId: course.id, weight, value, title, description, subgrades });
    }
    saveState();
    closeModal();
    render();
  }

  function saveSemester(id = null) {
    const input = document.getElementById('m-semester-title');
    const title = input?.value.trim() || `Semestre ${state.semesters.length + 1}`;
    if (id != null) {
      const semester = semesterById(id);
      if (semester) semester.title = title;
    } else {
      state.semesters.push({ id: nextId('semester'), title });
    }
    saveState();
    closeModal();
    render();
  }

  function openSemesterModal(id = null) {
    const semester = id == null ? null : semesterById(id);
    modal = { type: 'semester', id };
    document.body.insertAdjacentHTML('beforeend', modalHtml(semester ? 'Editar semestre' : 'Nuevo semestre', `<label>Nombre<input id="m-semester-title" maxlength="50" value="${esc(semester?.title || '')}" placeholder="Semestre ${state.semesters.length + 1}"></label>`, `<button data-close-modal>Cancelar</button><button class="primary" data-save-semester>${semester ? 'Guardar' : 'Crear'}</button>`));
    bindModal();
  }

  function transferSemesterToCurrent(id) {
    const semester = semesterById(id);
    if (!semester) return;
    const current = currentCourses();
    if (current.length) return showMessage('Debes vaciar el registro actual antes de transferir un semestre.');
    const courses = state.courses.filter(c => c.semesterId === semester.id);
    if (!courses.length) return showMessage('No puedes transferir un registro vacío.');
    for (const c of courses) c.semesterId = null;
    saveState();
    navigate('record');
  }

  function saveCurrentAsSemester() {
    const current = currentCourses();
    if (!current.length) return showMessage('No hay asignaturas en el registro actual.');
    openSemesterModal(null);
    const originalSave = saveSemester;
    // The regular semester creation is enough; assignment happens after creation in the click handler.
    modal.afterCreateCurrent = true;
  }

  function showMessage(message) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grader-registro.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeState(JSON.parse(reader.result));
        if (!Array.isArray(imported.courses) || !Array.isArray(imported.grades) || !Array.isArray(imported.semesters)) throw new Error();
        state = imported;
        saveState();
        render();
        showMessage('Registro importado correctamente.');
      } catch (_) {
        showMessage('El archivo no tiene un registro de Grader válido.');
      }
    };
    reader.readAsText(file);
  }

  function render() {
    applyTheme();
    let html;
    if (page.name === 'home') html = homePage();
    else if (page.name === 'course') html = coursePage(page.id);
    else if (page.name === 'grades') html = gradesPage();
    else if (page.name === 'record') html = recordPage();
    else if (page.name === 'semester') html = semesterPage(page.id);
    else if (page.name === 'config') html = configPage();
    else html = homePage();
    document.getElementById('app').innerHTML = html;
    bindPage();
  }

  function bindPage() {
    document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.nav)));
    document.querySelectorAll('[data-open-course]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('[data-edit-course],[data-delete-course],[data-record-course]')) return;
      navigate('course', Number(el.dataset.openCourse));
    }));
    document.querySelectorAll('[data-add-course]').forEach(el => el.addEventListener('click', () => openCourseModal(null, el.dataset.semester == null ? null : Number(el.dataset.semester))));
    document.querySelectorAll('[data-edit-course]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openCourseModal(Number(el.dataset.editCourse)); }));
    document.querySelectorAll('[data-delete-course]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); deleteCourse(Number(el.dataset.deleteCourse)); }));
    document.querySelectorAll('[data-add-grade]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openGradeModal(null, Number(el.dataset.addGrade)); }));
    document.querySelectorAll('[data-open-grade]').forEach(el => el.addEventListener('click', e => { if (!e.target.closest('[data-edit-grade],[data-delete-grade]')) openGradeModal(Number(el.dataset.openGrade)); }));
    document.querySelectorAll('[data-edit-grade]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openGradeModal(Number(el.dataset.editGrade)); }));
    document.querySelectorAll('[data-delete-grade]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); deleteGrade(Number(el.dataset.deleteGrade)); }));
    document.querySelectorAll('[data-add-semester]').forEach(el => el.addEventListener('click', () => openSemesterModal()));
    document.querySelectorAll('[data-open-sem]').forEach(el => el.addEventListener('click', () => navigate('semester', Number(el.dataset.openSem))));
    document.querySelectorAll('[data-edit-sem]').forEach(el => el.addEventListener('click', () => openSemesterModal(Number(el.dataset.editSem))));
    document.querySelectorAll('[data-delete-sem]').forEach(el => el.addEventListener('click', () => deleteSemester(Number(el.dataset.deleteSem))));
    document.querySelectorAll('[data-transfer-sem]').forEach(el => el.addEventListener('click', () => transferSemesterToCurrent(Number(el.dataset.transferSem))));
    document.querySelectorAll('[data-save-current]').forEach(el => el.addEventListener('click', () => { openSemesterModal(); if (modal) modal.afterCreateCurrent = true; }));

    const scale = document.getElementById('cfg-scale');
    if (scale) scale.addEventListener('change', () => { state.config.typeGradeId = Number(scale.value); saveState(); render(); });
    const min = document.getElementById('cfg-min');
    if (min) min.addEventListener('change', () => { const n = num(min.value); state.config.minToPass = n == null ? null : Math.max(0,n); saveState(); render(); });
    const direct = document.getElementById('cfg-direct');
    if (direct) direct.addEventListener('change', () => { state.config.directPercentage = direct.checked; saveState(); render(); });
    const round = document.getElementById('cfg-round');
    if (round) round.addEventListener('change', () => { state.config.roundFinal = round.checked; saveState(); render(); });
    const theme = document.getElementById('cfg-theme');
    if (theme) theme.addEventListener('change', () => { state.config.theme = theme.value; saveState(); render(); });
    document.querySelectorAll('[data-export]').forEach(el => el.addEventListener('click', exportData));
    document.querySelectorAll('[data-reset]').forEach(el => el.addEventListener('click', () => { if (confirm('Esto eliminará todos los datos guardados. ¿Continuar?')) { state = deepClone(DEFAULT_STATE); saveState(); navigate('home'); } }));
    const importFile = document.getElementById('import-file');
    if (importFile) importFile.addEventListener('change', () => importData(importFile.files[0]));
  }

  function bindModal() {
    const root = document.querySelector('[data-modal]');
    if (!root) return;
    root.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));
    root.addEventListener('click', e => { if (e.target === root) closeModal(); });
    const saveCourse = root.querySelector('[data-save-course]');
    if (saveCourse) saveCourse.addEventListener('click', saveCourseFromModal);
    const saveGrade = root.querySelector('[data-save-grade]');
    if (saveGrade) saveGrade.addEventListener('click', saveGradeFromModal);
    const saveSemesterBtn = root.querySelector('[data-save-semester]');
    if (saveSemesterBtn) saveSemesterBtn.addEventListener('click', () => {
      const createCurrent = modal?.afterCreateCurrent;
      const before = state.courses.filter(c => c.semesterId == null).map(c => c.id);
      saveSemester(modal.id);
      if (createCurrent) {
        const semester = state.semesters[state.semesters.length - 1];
        for (const c of state.courses) if (before.includes(c.id)) c.semesterId = semester.id;
        saveState();
        navigate('semester', semester.id);
      }
    });
    const courseSelect = root.querySelector('#m-grade-course');
    if (courseSelect) courseSelect.addEventListener('change', updateGradeFormForCourse);
    const addSub = root.querySelector('[data-add-sub]');
    if (addSub) addSub.addEventListener('click', () => addSubRow(root.querySelector('#subgrade-list')));
  }

  function deleteCourse(id) {
    if (!confirm('¿Eliminar esta asignatura y todas sus evaluaciones?')) return;
    state.courses = state.courses.filter(c => c.id !== id);
    state.grades = state.grades.filter(g => g.courseId !== id);
    saveState();
    navigate(page.name === 'course' ? 'home' : page.name, page.name === 'course' ? null : page.id);
  }

  function deleteGrade(id) {
    if (!confirm('¿Eliminar esta evaluación?')) return;
    state.grades = state.grades.filter(g => g.id !== id);
    saveState();
    render();
  }

  function deleteSemester(id) {
    if (!confirm('¿Eliminar este semestre? Sus asignaturas volverán al registro actual.')) return;
    state.courses.forEach(c => { if (c.semesterId === id) c.semesterId = null; });
    state.semesters = state.semesters.filter(s => s.id !== id);
    saveState();
    navigate('record');
  }

  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) {
      state = loadState();
      render();
    }
  });

  render();
})();

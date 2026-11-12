/**
 * @module usuariosView
 * @description HU19 — Administración de usuarios: crear, asignar rol y sede, activar/desactivar,
 * restablecer contraseña (política RNF-05) y desbloquear cuentas bloqueadas por intentos fallidos (HU20).
 */

import '../../assets/operaciones.css';
import { renderView } from '../../router.js';
import { buildSidebar, attachSidebarLogout } from '../../components/sidebar.js';
import { abrirModal } from '../../components/modal.js';
import { getCatalogo } from '../../services/catalogoService.js';
import { getUsuarios, crearUsuario, actualizarUsuario, restablecerPassword, desbloquearUsuario } from '../../services/adminService.js';
import { getUser } from '../../services/authService.js';
import { showToast } from '../../utils/toast.js';
import { esc, fechaHora } from '../../utils/format.js';

let datos = { usuarios: [], roles: {}, rolesConSede: [] };
let sedes = [];

const optsRoles = (sel) => Object.entries(datos.roles).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
const optsSedes = (sel) => `<option value="">— Sin sede —</option>${sedes.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}`;

const render = () => {
  document.getElementById('us-lista').innerHTML = `
    <div style="overflow-x:auto;"><table class="data-table">
      <thead><tr><th>Usuario</th><th>Rol</th><th>Sede</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
      <tbody>${datos.usuarios.map((u) => `
        <tr style="${u.activo ? '' : 'opacity:.55;'}">
          <td><strong>${esc(u.nombre)}</strong><br><span class="product-sku">${esc(u.usuario)}</span></td>
          <td>${esc(u.rolNombre)}</td>
          <td>${esc(u.sede ?? '—')}</td>
          <td>${!u.activo ? '<span class="badge badge-danger">Inactivo</span>'
            : u.bloqueado ? `<span class="badge badge-warning" title="Hasta ${esc(fechaHora(u.bloqueadoHasta))}">Bloqueado</span>`
            : '<span class="badge badge-success">Activo</span>'}</td>
          <td class="op-item-meta">${u.ultimoAcceso ? fechaHora(u.ultimoAcceso) : 'Nunca'}</td>
          <td><div class="op-item-actions">
            <button type="button" class="btn btn-sm btn-secondary" data-editar="${u.id}">Editar</button>
            <button type="button" class="btn btn-sm btn-secondary" data-clave="${u.id}">Contraseña</button>
            ${u.bloqueado ? `<button type="button" class="btn btn-sm btn-primary" data-desbloquear="${u.id}">Desbloquear</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
};

const recargar = async () => { datos = await getUsuarios(); render(); };

/** Muestra u oculta el selector de sede según el rol (los roles de tienda la exigen). */
const enlazarRolSede = (form) => {
  const rol = form.querySelector('[name=rol]'), hint = form.querySelector('.us-sede-hint');
  const act = () => { hint.textContent = datos.rolesConSede.includes(rol.value) ? 'Este rol solo opera en su sede: es obligatoria.' : 'Opcional para este rol.'; };
  rol.addEventListener('change', act); act();
};

const formUsuario = (u) => `
  <form class="op-form" id="us-form" novalidate>
    ${u ? '' : `<div class="form-group"><label class="form-label">Usuario *</label><input name="usuario" class="form-input" placeholder="ej. ana.lopez" autocomplete="off" /></div>`}
    <div class="form-group"><label class="form-label">Nombre *</label><input name="nombre" class="form-input" value="${esc(u?.nombre ?? '')}" /></div>
    <div class="op-row">
      <div class="form-group"><label class="form-label">Rol *</label><select name="rol" class="form-select">${optsRoles(u?.rol ?? 'VENDEDOR')}</select></div>
      <div class="form-group"><label class="form-label">Sede</label><select name="sedeId" class="form-select">${optsSedes(u?.sedeId ?? null)}</select>
        <p class="op-hint us-sede-hint"></p></div>
    </div>
    ${u ? `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''} ${u.id === getUser().id ? 'disabled' : ''} /> Cuenta activa</label>`
      : `<div class="form-group"><label class="form-label">Contraseña inicial *</label><input name="password" type="password" class="form-input" autocomplete="new-password" />
         <p class="op-hint">Mínimo 8 caracteres, con letras y números. Pídele que la cambie al entrar.</p></div>`}
    <button type="submit" class="btn btn-primary" style="justify-content:center;">${u ? 'Guardar cambios' : 'Crear usuario'}</button>
  </form>`;

const abrirForm = (u = null) => {
  const { overlay, close } = abrirModal(u ? `Editar · ${esc(u.usuario)}` : 'Nuevo usuario', formUsuario(u));
  const form = overlay.querySelector('#us-form');
  enlazarRolSede(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const payload = { nombre: f.nombre, rol: f.rol, sedeId: f.sedeId ? Number(f.sedeId) : null };
    try {
      if (u) await actualizarUsuario(u.id, { ...payload, activo: u.id === getUser().id ? true : !!form.activo.checked });
      else await crearUsuario({ ...payload, usuario: f.usuario, password: f.password });
      showToast(u ? 'Usuario actualizado.' : `Usuario ${f.usuario} creado.`, 'success');
      close();
      await recargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
};

export const initUsuarios = async () => {
  renderView(`<div class="app-shell">${buildSidebar('usuarios')}<main class="main-content"><div class="page-wrapper">
    <div class="loader-container"><div class="spinner"></div> Cargando…</div></div></main></div>`);
  try {
    const [u, cat] = await Promise.all([getUsuarios(), getCatalogo()]);
    datos = u; sedes = cat.ubicaciones;
  } catch (err) { showToast(err.message, 'error'); }

  renderView(`
    <div class="app-shell">
      ${buildSidebar('usuarios')}
      <main class="main-content"><div class="page-wrapper">
        <header class="page-header">
          <div><h1 class="page-title">Usuarios</h1>
            <p class="page-subtitle">Cada persona accede solo a lo de su rol; vendedores y administradores de tienda, solo a su sede.</p></div>
          <button type="button" id="us-nuevo" class="btn btn-primary">＋ Nuevo usuario</button>
        </header>
        <div class="card op-card" id="us-lista"></div>
        <div class="card op-card">
          <h2 class="section-title">Qué puede hacer cada rol</h2>
          <div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Rol</th><th>Alcance</th></tr></thead><tbody>
            <tr><td>Administrador</td><td>Todo, incluidos usuarios, parámetros y procesos.</td></tr>
            <tr><td>Jefe de bodega</td><td>Catálogo, compras, traslados, aprueba ajustes, conteos, mínimos, informes.</td></tr>
            <tr><td>Auxiliar de bodega</td><td>Entradas, despachos, recepción de compras, traslados, registra ajustes, captura conteos, etiquetas.</td></tr>
            <tr><td>Administrador de tienda</td><td>Su sede: ventas, cambios, reservas, traslados, ajustes, mínimos e informes.</td></tr>
            <tr><td>Vendedor</td><td>Su sede: ventas, cambios, reservas y consultas.</td></tr>
            <tr><td>Auditor</td><td>Solo consulta: inventario, kardex e informes.</td></tr>
          </tbody></table></div>
        </div>
      </div></main>
    </div>`);
  attachSidebarLogout();
  render();

  document.getElementById('us-nuevo').addEventListener('click', () => abrirForm());
  document.getElementById('us-lista').addEventListener('click', async (e) => {
    const id = (attr) => Number(e.target.closest(`[${attr}]`)?.getAttribute(attr));
    try {
      if (e.target.closest('[data-editar]')) return abrirForm(datos.usuarios.find((u) => u.id === id('data-editar')));
      if (e.target.closest('[data-clave]')) {
        const u = datos.usuarios.find((x) => x.id === id('data-clave'));
        const clave = prompt(`Nueva contraseña para ${u.usuario} (mínimo 8 caracteres con letras y números):`);
        if (!clave) return;
        await restablecerPassword(u.id, clave);
        showToast('Contraseña restablecida y cuenta desbloqueada.', 'success');
      } else if (e.target.closest('[data-desbloquear]')) {
        await desbloquearUsuario(id('data-desbloquear'));
        showToast('Cuenta desbloqueada.', 'success');
      } else return;
      await recargar();
    } catch (err) { showToast(err.message, 'error'); }
  });
};

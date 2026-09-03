import './styles.css';
import { animate, stagger } from 'motion';
import { icon, Icons } from './icons';
import {
  ApiError,
  createProfile,
  getPromotionVouchers,
  getStudentDocumentUrl,
  loadAdminData,
  loadPublicBranches,
  loadPublicData,
  reviewIssue,
  reviewPromoRequests,
  saveBranch,
  savePromotion,
  submitIssue,
  submitPromoRequest,
  updateProfile,
  uploadStudentDocument,
} from './api';
import {
  appConfig,
  buildPortalVoucherUrl,
  clearProfileToken,
  getProfileToken,
  hasAdminAuthConfig,
  hasBackendConfig,
  saveProfileToken,
  supabase,
} from './config';
import {
  applyColumnMapping,
  extractHeadersFromMatrix,
  normalizeVoucherCode,
  parseRawVoucherText,
  parseSpreadsheetFile,
  type ColumnMapping,
  type SpreadsheetParseResult,
} from './importer';
import { enableNotifications, getNotificationAvailability, requestNotificationPermission } from './notifications';
import type {
  AdminData,
  AdminIssue,
  AdminPromotion,
  AdminRequest,
  Audience,
  Branch,
  CreditUnit,
  FulfillmentType,
  Issue,
  IssueType,
  Profile,
  PromoRequest,
  Promotion,
  PublicData,
  RequestStatus,
  VoucherInventoryItem,
} from './types';
import {
  firstError,
  normalizeDeviceId,
  parseNonNegativeNumber,
  parsePositiveNumber,
  validateDocument,
  validateGhostCredit,
  validateLostPoints,
  validateProfile,
  validateProfileEdit,
} from './validation';
import type { Session } from '@supabase/supabase-js';

type View = 'onboarding' | 'home' | 'admin-login' | 'admin' | 'privacy';
type HomeTab = 'promos' | 'issues';
type AdminTab = 'overview' | 'promos' | 'requests' | 'issues' | 'branches';
type OnboardingStep = 'story' | 'form';

interface AppState {
  view: View;
  homeTab: HomeTab;
  adminTab: AdminTab;
  onboardingStep: OnboardingStep;
  targetPromoId: string | null;
  issueComposer: IssueType | null;
  activePromoRequest: string | null;
  editingPromotionId: string | null;
  editingBranchId: string | null;
  editingProfile: boolean;
  selectedRequestId: string | null;
  selectedIssueId: string | null;
  profile: Profile | null;
  publicData: PublicData | null;
  branches: Branch[];
  adminData: AdminData | null;
  adminSession: Session | null;
  adminToken: string | null;
  loading: boolean;
  error: string;
  toast: string;
  requestStatusFilter: RequestStatus | 'all';
  requestBranchFilter: string;
  requestPromotionFilter: string;
  issueStatusFilter: RequestStatus | 'all';
  issueBranchFilter: string;
  // Voucher Importer & Inventory state
  editingFulfillmentType: FulfillmentType;
  importerActiveTab: 'paste' | 'file';
  importerTextDraft: string;
  importerSpreadsheet: SpreadsheetParseResult | null;
  importerMapping: ColumnMapping;
  importerFallbackDuration: string;
  importerSelectedBranchId: string;
  voucherModalPromotionId: string | null;
  voucherModalList: VoucherInventoryItem[] | null;
  voucherModalLoading: boolean;
  voucherSearchQuery: string;
  activeClaimedVoucher: { promoName: string; code: string; duration?: string; isDirectLink?: boolean; portalUrl?: string } | null;
  adminPrefillEmail?: string;
  adminPrefillPassword?: string;
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing.');
const appRoot = root;

const state: AppState = {
  view: 'onboarding',
  homeTab: 'promos',
  adminTab: 'overview',
  onboardingStep: 'story',
  targetPromoId: null,
  issueComposer: null,
  activePromoRequest: null,
  editingPromotionId: null,
  editingBranchId: null,
  editingProfile: false,
  selectedRequestId: null,
  selectedIssueId: null,
  profile: null,
  publicData: null,
  branches: [],
  adminData: null,
  adminSession: null,
  adminToken: null,
  loading: false,
  error: '',
  toast: '',
  requestStatusFilter: 'pending',
  requestBranchFilter: 'all',
  requestPromotionFilter: 'all',
  issueStatusFilter: 'pending',
  issueBranchFilter: 'all',
  editingFulfillmentType: 'manual_topup',
  importerActiveTab: 'paste',
  importerTextDraft: '',
  importerSpreadsheet: null,
  importerMapping: { codeColIndex: 0, timeColIndex: -1, labelColIndex: -1, branchColIndex: -1 },
  importerFallbackDuration: '',
  importerSelectedBranchId: 'all',
  voucherModalPromotionId: null,
  voucherModalList: null,
  voucherModalLoading: false,
  voucherSearchQuery: '',
  activeClaimedVoucher: null,
};
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"') return '&quot;';
    return '&#39;';
  });
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(status: RequestStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: RequestStatus): string {
  return `status status-${status}`;
}

function audienceLabel(audience: Audience): string {
  return audience === 'students' ? 'Para sa students' : 'Para sa lahat';
}

function unitLabel(unit: CreditUnit | null): string {
  if (unit === 'money') return 'Pera';
  if (unit === 'time') return 'Oras';
  if (unit === 'coins') return 'Coins';
  return '—';
}

function setError(message: string): void {
  state.error = message;
  state.toast = '';
  render();
}

function setToast(message: string): void {
  state.toast = message;
  state.error = '';
  render();
  window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = '';
      render();
    }
  }, 4500);
}

function renderNotice(): string {
  if (state.error) return `<div class="notice notice-error" role="alert">${escapeHtml(state.error)}</div>`;
  if (state.toast) return `<div class="notice notice-success" role="status">${escapeHtml(state.toast)}</div>`;
  return '';
}

function renderBrand(link = false): string {
  const content = `<span class="brand-icon" aria-hidden="true">${icon(Icons.Radio, 'brand-svg', 20)}</span><span class="brand-title">${escapeHtml(appConfig.appName)}</span>`;
  return link ? `<a class="brand" href="#/">${content}</a>` : `<div class="brand">${content}</div>`;
}

function renderConfigNotice(): string {
  if (hasBackendConfig) return '';
  return `
    <div class="setup-callout" role="status">
      <div class="callout-icon" aria-hidden="true">!</div>
      <div><strong>Demo mode</strong><p>Ikabit ang Supabase para lumabas ang branches at ma-save ang requests.</p></div>
    </div>
  `;
}

function renderOnboarding(): string {
  return state.onboardingStep === 'form' ? renderOnboardingForm() : renderOnboardingStory();
}

function renderOnboardingStory(): string {
  const isPromoShared = Boolean(state.targetPromoId);
  return `
    <main class="onboarding-page story-page">
      <div class="onboarding-frame story-frame">
        <header class="onboarding-header">
          ${renderBrand()}
          ${isPromoShared ? `
            <div class="modular-step-header">
              <div class="step-badge is-active">${icon(Icons.Gift, 'step-icon-active', 13)} <span>1. Promo Link</span></div>
              <div class="step-connector"></div>
              <div class="step-badge"><span class="step-num-circle">2</span> <span>Setup</span></div>
              <div class="step-connector"></div>
              <div class="step-badge"><span class="step-num-circle">3</span> <span>Claim</span></div>
            </div>
          ` : `
            <div class="header-status-pill"><span class="live-dot"></span><span>DXTECH Hub Portal</span></div>
          `}
        </header>

        ${renderNotice()}
        ${renderConfigNotice()}

        <section class="story-hero-section">
          <div class="hero-badge">${icon(Icons.Radio, 'badge-icon', 14)} <span>DXTECH PisoWiFi Community Hub</span></div>
          <h1 class="story-hero-title">Welcome sa DXTECH PisoWiFi Hub!</h1>
          <p class="story-hero-subtext">Isang komunidad at pamilyang konektado. Dito mo makukuha ang mga pinakabagong discounts, libreng dagdag oras, at mabilisang tulong sa iyong Piso Wi-Fi connection.</p>

          ${isPromoShared ? `
            <div class="shared-promo-alert">
              <div class="shared-promo-icon-box">${icon(Icons.Gift, 'shared-gift-icon', 24)}</div>
              <div class="shared-promo-text">
                <span class="shared-promo-pill">EXCLUSIVE SHARE LINK</span>
                <h3>May inihandang Promo para sa'yo!</h3>
                <p>Nasa <b>Hakbang 1 ng 3</b> ka na. Tapusin ang mabilisang 1-minutong setup para ma-claim ang iyong promo sa device na ito.</p>
              </div>
            </div>
          ` : ''}

          <div class="story-showcase-grid">
            <div class="story-card">
              <div class="story-card-top">
                <span class="story-icon-box">${icon(Icons.Gift, 'story-svg', 22)}</span>
                <span class="story-tag">Pampamilya & Estudyante</span>
              </div>
              <h3>Exclusive Promos & Discounts</h3>
              <p>Mag-claim ng libreng dagdag oras, student rewards, at loyalty discounts na eksklusibo sa iyong DXTECH branch.</p>
            </div>

            <div class="story-card">
              <div class="story-card-top">
                <span class="story-icon-box">${icon(Icons.Wrench, 'story-svg', 22)}</span>
                <span class="story-tag">Diretsong Tulong</span>
              </div>
              <h3>Mabilisang Support sa Hulog at Points</h3>
              <p>May concern sa nahulog na barya o points? I-report agad at direktang aaksyunan ng ating branch admin.</p>
            </div>

            <div class="story-card">
              <div class="story-card-top">
                <span class="story-icon-box">${icon(Icons.ShieldCheck, 'story-svg', 22)}</span>
                <span class="story-tag">Ligtas at Maaasahan</span>
              </div>
              <h3>Protektadong Koneksyon</h3>
              <p>One-time setup lang gamit ang Device ID. Walang password na kailangang tandaan at 100% pribado.</p>
            </div>
          </div>

          <div class="story-action-center">
            <button type="button" class="primary-action action-wide action-hero" data-action="start-setup">
              <span>${isPromoShared ? 'I-claim ang Aking Promo (1-Min Setup)' : 'Magsimula Na (1-Minutong Setup)'}</span>
              <span class="action-arrow" aria-hidden="true">${icon(Icons.ArrowRight, 'btn-arrow-svg', 18)}</span>
            </button>
            <p class="story-action-hint">${icon(Icons.Zap, 'zap-hint-icon', 13)} Walang bayad at 1-minuto lang. Diretso kang makakapasok sa portal.</p>
          </div>
        </section>
      </div>
    </main>
  `;
}

function renderOnboardingForm(): string {
  const notificationStatus = getNotificationAvailability();
  const notificationCopy = notificationStatus === 'unsupported'
    ? 'Hindi supported ng browser ang alerts.'
    : notificationStatus === 'permission-denied'
      ? 'Naka-block ang alerts sa browser.'
      : notificationStatus === 'missing-key'
        ? 'Hindi pa naka-set up ang alerts.'
        : 'Makakuha ng alert kapag na-approve ang promo request mo.';
  const branchOptions = state.branches.length
    ? `<option value="">Pumili ng iyong branch</option>${state.branches.map((branch) => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`).join('')}`
    : '<option value="">Wala pang branch</option>';
  const helpImageUrl = appConfig.helpImageUrl;
  const helpImage = helpImageUrl && (/^https:\/\//.test(helpImageUrl) || helpImageUrl.startsWith('/'))
    ? `<figure class="help-figure"><img src="${escapeHtml(helpImageUrl)}" alt="Router screenshot: naka-highlight ang Device ID sa Client Info." loading="lazy" decoding="async" /><figcaption>${icon(Icons.Info, 'caption-icon', 14)} Hanapin ang ID sa ilalim ng Client Info sa 10.0.0.1 portal.</figcaption></figure>`
    : '';

  return `
    <main class="onboarding-page form-stage-page">
      <div class="onboarding-frame form-frame">
        <header class="onboarding-header">
          ${renderBrand()}
          <div class="modular-step-header">
            <button type="button" class="step-badge is-done" data-action="back-to-story">${icon(Icons.Check, 'step-check', 12)} <span>1. Story</span></button>
            <div class="step-connector is-done"></div>
            <div class="step-badge is-active"><span class="step-num-circle">2</span> <span>Mabilisang Setup</span></div>
            <div class="step-connector"></div>
            <div class="step-badge"><span class="step-num-circle">3</span> <span>Pumasok</span></div>
          </div>
        </header>

        ${renderNotice()}
        ${renderConfigNotice()}

        <section class="form-stage-container">
          <form class="form-panel onboarding-card" id="onboarding-form">
            <div class="panel-heading">
              <div class="panel-header-with-back">
                <button type="button" class="btn-text-back" data-action="back-to-story">${icon(Icons.ChevronRight, 'back-arrow-flipped', 14)} <span>Bumalik sa Story</span></button>
                <span class="panel-pill">HAKBANG 2 / 3: PROFILE</span>
              </div>
              <h2>Personal na Impormasyon</h2>
              <p class="panel-subhead">One-time setup lang para ma-save ang iyong profile sa device na ito.</p>
            </div>

            <div class="field-grid">
              <label class="field field-wide">
                <span class="field-label">${icon(Icons.Smartphone, 'field-icon-svg', 16)} Device ID <b>*</b></span>
                <input data-device-id name="deviceId" autocomplete="off" inputmode="text" maxlength="64" placeholder="ABC123456" required class="input-modern" />
                <small class="field-hint">Letters at numbers lang. Kopyahin mula sa Client Info sa 10.0.0.1 portal. Isang profile lang ang puwedeng naka-link sa bawat Device ID.</small>
              </label>

              <div class="help-guide-card field-wide">
                <div class="help-guide-head">
                  <span class="help-guide-icon">${icon(Icons.HelpCircle, 'guide-head-svg', 18)}</span>
                  <div>
                    <strong>Saan makikita ang Device ID sa DXTECH?</strong>
                    <p>Mabilisang 3-step guide para sa iyong koneksyon:</p>
                  </div>
                </div>
                <div class="help-steps">
                  <div class="help-step"><span class="step-num">1</span><span>Kumonek sa <b>DXTECH PisoWiFi</b></span></div>
                  <div class="help-step"><span class="step-num">2</span><span>Buksan ang <a href="http://10.0.0.1/" target="_blank" rel="noreferrer" class="link-highlight">10.0.0.1 ${icon(Icons.ExternalLink, 'link-icon-xs', 12)}</a></span></div>
                  <div class="help-step"><span class="step-num">3</span><span>Kopyahin ang <b>ID</b> sa <b>Client Info</b></span></div>
                </div>
                ${helpImage ? `
                  <details class="help-accordion">
                    <summary class="help-summary">
                      <span class="help-summary-title">${icon(Icons.ImageIcon, 'summary-icon', 15)} Tingnan ang visual guide screenshot</span>
                      <span class="help-chevron">${icon(Icons.ChevronDown, 'chevron-svg', 14)}</span>
                    </summary>
                    <div class="help-accordion-body">
                      ${helpImage}
                    </div>
                  </details>
                ` : ''}
              </div>

              <label class="field">
                <span class="field-label">${icon(Icons.User, 'field-icon-svg', 16)} Buong Pangalan <b>*</b></span>
                <input name="name" autocomplete="name" maxlength="120" placeholder="Juan Dela Cruz" required class="input-modern" />
              </label>

              <label class="field">
                <span class="field-label">${icon(Icons.MapPin, 'field-icon-svg', 16)} Piliin ang Branch <b>*</b></span>
                <div class="select-wrapper">
                  <select name="branchId" required ${state.branches.length ? '' : 'disabled'} class="input-modern select-modern">${branchOptions}</select>
                </div>
                ${state.branches.length ? '' : `<small class="field-warning">${icon(Icons.AlertTriangle, 'warn-icon', 13)} Wala pang branch na naka-set up sa system.</small>`}
              </label>

              <label class="field field-wide">
                <span class="field-label">${icon(Icons.GraduationCap, 'field-icon-svg', 16)} School ID / Student ID <em>(Optional)</em></span>
                <div class="custom-file-dropzone">
                  <input name="studentDocument" type="file" accept="image/jpeg,image/png,image/webp" class="file-input-overlay" id="studentDocument" />
                  <div class="dropzone-inner">
                    <div class="dropzone-icon-box">${icon(Icons.UploadCloud, 'dropzone-cloud-icon', 22)}</div>
                    <div class="dropzone-texts">
                      <strong class="dropzone-main-text">Pumili ng School ID litrato o i-drag dito</strong>
                      <span class="dropzone-sub-text file-chosen-name">JPG, PNG, o WebP (Max 5 MB) • Para lamang sa Student Promos</span>
                    </div>
                  </div>
                </div>
              </label>
            </div>

            <div class="permission-card">
              <div class="permission-info">
                <span class="permission-icon">${icon(Icons.Bell, 'permission-bell-svg', 20)}</span>
                <div>
                  <strong>Browser Alerts (Optional)</strong>
                  <p>${escapeHtml(notificationCopy)}</p>
                </div>
              </div>
              <label class="switch-toggle">
                <input type="checkbox" name="notifyOptIn" ${notificationStatus !== 'available' ? 'disabled' : ''}/>
                <span class="switch-slider"></span>
                <span class="switch-text">I-on</span>
              </label>
            </div>

            <label class="consent-row">
              <input type="checkbox" name="privacyConsent" required />
              <span>Sumasang-ayon akong i-save ang profile at School ID para sa pagsusuri. <a href="#/privacy" class="link-inline">Privacy Policy</a>.</span>
            </label>

            <div class="form-action-row">
              <button type="button" class="btn-secondary-modern" data-action="back-to-story">← Bumalik</button>
              <button class="primary-action action-glow" type="submit" ${state.loading || !hasBackendConfig || !state.branches.length ? 'disabled' : ''}>
                <span>${state.loading ? 'Sine-save ang iyong profile…' : 'Tapusin at Pumasok sa Hub'}</span>
                <span class="action-arrow" aria-hidden="true">${icon(Icons.ArrowRight, 'btn-arrow-svg', 18)}</span>
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  `;
}

function renderProfileRail(): string {
  const profile = state.profile;
  if (!profile) return '';
  const initials = profile.name.split(' ').map((word) => word[0] || '').join('').slice(0, 2).toUpperCase() || 'U';
  const notificationStatus = getNotificationAvailability();
  const notificationAction = profile.notificationsEnabled
    ? `<span class="rail-state rail-state-on">${icon(Icons.Bell, 'bell-status-icon', 13)} Naka-on</span>`
    : notificationStatus === 'unsupported' || notificationStatus === 'permission-denied' || notificationStatus === 'missing-key'
      ? '<span class="rail-state">Hindi available</span>'
      : '<button class="text-action-link" type="button" data-action="enable-notifications">I-on ang Alerts</button>';
  return `
    <aside class="profile-rail">
      <div class="rail-top">
        ${renderBrand(true)}
        <span class="status-pill-subtle"><span class="live-dot"></span> Online</span>
      </div>
      
      <div class="profile-card-sidebar">
        <div class="avatar-badge">${escapeHtml(initials)}</div>
        <div class="profile-name">${escapeHtml(profile.name)}</div>
        <div class="profile-branch-badge">${icon(Icons.MapPin, 'branch-pin-svg', 13)} ${escapeHtml(profile.branchName)}</div>
      </div>
      
      <div class="profile-data-card">
        <div class="data-row">
          <span class="data-label">DEVICE ID</span>
          <div class="device-id-row">
            <strong>${escapeHtml(profile.deviceId)}</strong>
            <button class="copy-chip-btn" type="button" data-action="copy-id" data-copy-value="${escapeHtml(profile.deviceId)}" title="Kopyahin">${icon(Icons.Copy, 'copy-icon-svg', 13)}</button>
          </div>
        </div>
        <div class="data-row">
          <span class="data-label">SCHOOL ID</span>
          <span class="badge-status ${profile.hasStudentDocument ? 'badge-verified' : 'badge-unverified'}">${profile.hasStudentDocument ? `${icon(Icons.CheckCircle2, 'verified-icon-svg', 12)} Naka-save` : 'Wala pa'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">BROWSER ALERTS</span>
          <span>${notificationAction}</span>
        </div>
      </div>
      
      <div class="rail-bottom-actions">
        <button class="btn-outline-sidebar" type="button" data-action="edit-profile">${icon(Icons.Pencil, 'sidebar-action-icon', 14)} <span>I-edit ang profile</span></button>
      </div>
    </aside>
  `;
}

function renderProfileEditor(): string {
  const profile = state.profile;
  if (!profile || !state.editingProfile) return '';
  const disabled = state.loading ? 'disabled' : '';
  return `
    <section class="profile-editor-card" aria-labelledby="profile-editor-title">
      <div class="profile-editor-head">
        <div>
          <span class="panel-pill">PROFILE SETTINGS</span>
          <h2 id="profile-editor-title">I-edit ang profile</h2>
          <p class="profile-editor-copy">Ang changes ay ise-save sa parehong profile at mananatili ang iyong requests at reports.</p>
        </div>
        <button class="close-btn-modern" type="button" data-action="cancel-profile-edit" aria-label="Isara ang profile editor" ${disabled}>${icon(Icons.X, 'close-icon-svg', 16)}</button>
      </div>

      <form id="profile-edit-form">
        <div class="field-grid">
          <label class="field">
            <span class="field-label">${icon(Icons.Smartphone, 'field-icon-svg', 16)} Device ID <b>*</b></span>
            <input data-device-id name="deviceId" autocomplete="off" inputmode="text" maxlength="64" value="${escapeHtml(profile.deviceId)}" required class="input-modern" ${disabled} />
            <small class="field-hint">Letters at numbers lang. Isang profile lang ang puwedeng naka-link sa bawat Device ID.</small>
          </label>

          <label class="field">
            <span class="field-label">${icon(Icons.User, 'field-icon-svg', 16)} Buong Pangalan <b>*</b></span>
            <input name="name" autocomplete="name" maxlength="120" value="${escapeHtml(profile.name)}" required class="input-modern" ${disabled} />
          </label>
        </div>

        <div class="profile-locked-note">
          ${icon(Icons.Lock, 'locked-note-icon', 16)}
          <span><strong>Branch: ${escapeHtml(profile.branchName)}</strong><small>Naka-lock ito para manatiling tama ang history ng requests at reports mo.</small></span>
        </div>

        <div class="profile-editor-actions">
          <button class="btn-secondary-modern" type="button" data-action="cancel-profile-edit" ${disabled}>Kanselahin</button>
          <button class="primary-action" type="submit" ${disabled}>${state.loading ? 'Sine-save…' : 'I-save ang changes'} <span class="action-arrow" aria-hidden="true">${icon(Icons.Check, 'btn-icon-svg', 15)}</span></button>
        </div>
      </form>
    </section>
  `;
}

function renderHome(): string {
  if (!state.publicData || !state.profile) return `<main class="loading-page"><div class="loading-block"><span class="loading-spinner"></span> Nilo-load ang Announcement Room…</div></main>`;
  const promosCount = state.publicData.promotions.length;
  const issuesCount = state.publicData.issues.length;
  const requestsCount = state.publicData.requests.length;
  const showContextualRefresh = state.homeTab === 'promos'
    ? promosCount === 0 || requestsCount === 0
    : issuesCount === 0;
  return `
    <main class="room-layout">
      ${renderProfileRail()}
      <section class="room-main">
        <header class="room-header-modern">
          <div class="room-header-content">
            <div class="room-branch-pill">${icon(Icons.MapPin, 'branch-pin-svg', 13)} ${escapeHtml(state.profile.branchName)}</div>
            <h1>Mabuhay, ${escapeHtml(state.profile.name.split(' ')[0])}!</h1>
            <p class="header-copy">Pumili ng promo discounts o mag-report ng connection concerns para sa iyong device.</p>
          </div>
          <div class="header-actions-group">
            <div class="header-status-pill"><span class="live-dot"></span><span>Naka-sync</span></div>
            <button class="icon-button-refresh ${showContextualRefresh ? 'is-contextual-hidden' : ''}" type="button" data-action="refresh-public" title="I-refresh ang room" aria-label="I-refresh ang room">
              ${icon(Icons.RefreshCw, 'refresh-svg', 18)}
            </button>
          </div>
        </header>
        ${renderNotice()}
        ${renderProfileEditor()}
        <nav class="mode-tabs-pill" aria-label="Room menu">
          <button type="button" class="mode-tab-pill ${state.homeTab === 'promos' ? 'is-active' : ''}" data-action="home-tab" data-tab="promos">
            <span class="tab-icon">${icon(Icons.Gift, 'tab-icon-svg', 16)}</span>
            <span>Mga Promos at Perks</span>
            ${promosCount ? `<span class="tab-count">${promosCount}</span>` : ''}
          </button>
          <button type="button" class="mode-tab-pill ${state.homeTab === 'issues' ? 'is-active' : ''}" data-action="home-tab" data-tab="issues">
            <span class="tab-icon">${icon(Icons.Wrench, 'tab-icon-svg', 16)}</span>
            <span>Mag-report ng Issue</span>
            ${issuesCount ? `<span class="tab-count">${issuesCount}</span>` : ''}
          </button>
        </nav>
        ${state.homeTab === 'promos' ? renderPromoWorkspace() : renderIssueWorkspace()}
      </section>
    </main>
  `;
}

function renderVoucherDeliveryModal(): string {
  const voucher = state.activeClaimedVoucher;
  if (!voucher) return '';
  const portal = buildPortalVoucherUrl(voucher.code);
  return `
    <section class="voucher-delivery-card" aria-labelledby="voucher-card-title">
      <div class="inline-request-head">
        <div class="inline-head-title">
          <span class="badge-claim">${icon(Icons.Gift, 'badge-icon-svg', 13)} PROMO VOUCHER READY</span>
          <h3 id="voucher-card-title">${escapeHtml(voucher.promoName)}</h3>
          <p>Ready na ang iyong exclusive voucher code para sa DXTECH PisoWiFi.</p>
        </div>
        <button class="close-btn-modern" type="button" data-action="close-voucher-modal" aria-label="Close">${icon(Icons.X, 'close-svg', 16)}</button>
      </div>

      <div class="voucher-code-hero">
        <div>
          <span style="display: block; font-size: 0.74rem; font-weight: 800; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px;">ANG IYONG VOUCHER CODE</span>
          <strong class="voucher-code-val">${escapeHtml(voucher.code)}</strong>
        </div>
        <button class="btn-voucher-copy" type="button" data-action="copy-id" data-copy-value="${escapeHtml(voucher.code)}">
          ${icon(Icons.Copy, 'btn-icon-svg', 15)} <span>Kopyahin ang Code</span>
        </button>
      </div>

      <div class="voucher-guide-list">
        <div class="voucher-guide-item">
          <span class="voucher-step-badge">1</span>
          <span>Manatiling nakakonek sa <b>DXTECH PisoWiFi</b> network.</span>
        </div>
        <div class="voucher-guide-item">
          <span class="voucher-step-badge">2</span>
          <span>Buksan ang portal sa <a href="http://10.0.0.1/" target="_blank" rel="noreferrer" class="link-highlight">10.0.0.1 ${icon(Icons.ExternalLink, 'link-icon-xs', 12)}</a></span>
        </div>
        <div class="voucher-guide-item">
          <span class="voucher-step-badge">3</span>
          <span>Piliin ang <b>Use Voucher</b> at i-paste ang iyong voucher code para magsimula ang oras.</span>
        </div>
      </div>

      <div class="voucher-actions-group">
        <button class="btn-secondary-modern" type="button" data-action="close-voucher-modal">Isara</button>
        ${portal.isDirectLink ? `
          <a href="${escapeHtml(portal.url)}" target="_blank" rel="noreferrer" class="btn-portal-direct">
            <span>I-redeem Diretso sa Portal (10.0.0.1)</span>
            ${icon(Icons.ExternalLink, 'btn-icon-svg', 15)}
          </a>
        ` : `
          <a href="http://10.0.0.1/" target="_blank" rel="noreferrer" class="btn-portal-direct">
            <span>Buksan ang 10.0.0.1 Portal</span>
            ${icon(Icons.ExternalLink, 'btn-icon-svg', 15)}
          </a>
        `}
      </div>
    </section>
  `;
}

function renderPromoWorkspace(): string {
  const data = state.publicData;
  if (!data) return '';
  const promos = data.promotions;
  const requests = data.requests;
  return `
    <div class="workspace-grid">
      <section class="workspace-column">
        ${renderVoucherDeliveryModal()}
        <div class="section-heading"><div><p class="section-code">PROMOS</p><h2>Mga promo</h2></div><span class="count-mark">${String(promos.length).padStart(2, '0')}</span></div>
        ${promos.length ? `<div class="offer-list">${promos.map((promo, index) => renderPromoRow(promo, index)).join('')}</div>` : renderEmptyState('Walang promo sa branch na ito.', 'Balik dito kapag may bagong promo.', true)}
        ${state.activePromoRequest ? renderPromoRequestPanel(state.activePromoRequest) : ''}
      </section>
      <aside class="status-column">
        <div class="section-heading"><div><p class="section-code">MY REQUESTS</p><h2>Status</h2></div><span class="count-mark">${String(requests.length).padStart(2, '0')}</span></div>
        ${requests.length ? `<div class="status-list">${requests.map(renderRequestStatus).join('')}</div>` : renderEmptyState('Wala pang request.', 'Lalabas dito ang promo requests mo.', true)}
      </aside>
    </div>
  `;
}

function renderPromoRow(promo: Promotion, index: number): string {
  const requestStatus = promo.myRequestStatus;
  const isVoucher = promo.fulfillmentType === 'voucher';
  const isFull = promo.availableSlots <= 0;
  const percent = Math.round((promo.availableSlots / Math.max(promo.capacity, 1)) * 100);
  const progressClass = isFull ? 'is-empty' : promo.availableSlots <= 2 ? 'is-low' : 'is-good';
  const isStudent = promo.audience === 'students';
  const action = requestStatus
    ? `<span class="${statusClass(requestStatus)}">${icon(Icons.CheckCircle2, 'status-icon-inline', 13)} ${statusLabel(requestStatus)}</span>`
    : `<button class="primary-action promo-cta-btn" type="button" data-action="request-promo" data-promotion-id="${escapeHtml(promo.id)}" ${isFull ? 'disabled' : ''}>
        <span>${isFull ? 'Puno na ang slots' : isVoucher ? 'I-claim ang Voucher' : promo.requiresStudentDocument && !state.profile?.hasStudentDocument ? 'I-verify & I-claim' : 'I-claim ang Promo'}</span>
        <span class="action-arrow" aria-hidden="true">${isFull ? icon(Icons.Lock, 'btn-icon-svg', 14) : icon(Icons.ArrowRight, 'btn-icon-svg', 15)}</span>
      </button>`;
  return `
    <article class="offer-card ${isStudent ? 'offer-student' : 'offer-standard'}">
      <div class="offer-header-row">
        <span class="audience-tag ${isStudent ? 'audience-student' : 'audience-everyone'}">
          ${isStudent ? `${icon(Icons.GraduationCap, 'tag-icon-svg', 13)} Student Exclusive` : `${icon(Icons.Sparkles, 'tag-icon-svg', 13)} Para sa Lahat`}
        </span>
        ${isVoucher ? `<span class="audience-tag" style="background: rgba(249, 115, 22, 0.12); color: #fdba74;">${icon(Icons.Tag, 'tag-icon-svg', 12)} Instant Voucher</span>` : ''}
        <span class="branch-tag">${icon(Icons.MapPin, 'branch-icon-svg', 12)} ${escapeHtml(promo.branchName)}</span>
      </div>
      
      <div class="offer-content">
        <h3 class="offer-title">${escapeHtml(promo.name)}</h3>
        <p class="offer-description">${escapeHtml(promo.description || 'Sulitin ang special discount at rewards para sa branch na ito.')}</p>
        
        <div class="offer-badges-row">
          <span class="req-badge ${promo.requiresStudentDocument ? 'req-doc' : 'req-free'}">
            ${promo.requiresStudentDocument ? `${icon(Icons.FileText, 'req-icon-svg', 13)} Kailangan ng School ID` : `${icon(Icons.Check, 'req-icon-svg', 13)} Walang requirement`}
          </span>
        </div>

        ${promo.myVoucherCode ? `
          <div style="margin-top: 14px; padding: 12px 14px; border-radius: var(--radius-sm); background: #050b14; border: 1.5px dashed var(--orange); display: flex; align-items: center; justify-content: space-between; gap: 10px;">
            <div>
              <span style="display: block; font-size: 0.7rem; color: var(--ink-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">IYONG VOUCHER CODE</span>
              <strong style="font-family: ui-monospace, monospace; color: #fdba74; font-size: 1.15rem; letter-spacing: 0.06em;">${escapeHtml(promo.myVoucherCode)}</strong>
            </div>
            <button class="btn-copy-chip" type="button" data-action="copy-id" data-copy-value="${escapeHtml(promo.myVoucherCode)}">
              ${icon(Icons.Copy, 'icon-xs', 12)} <span>Kopyahin</span>
            </button>
          </div>
        ` : ''}
      </div>
      
      <div class="offer-footer-row">
        <div class="capacity-meter-box">
          <div class="capacity-labels">
            <span>Available slots</span>
            <strong>${promo.availableSlots} / ${promo.capacity}</strong>
          </div>
          <div class="capacity-track">
            <div class="capacity-fill ${progressClass}" style="width: ${percent}%;"></div>
          </div>
        </div>
        
        <div class="offer-cta-container">
          <button class="btn-share-promo" type="button" data-action="share-promo" data-promotion-id="${escapeHtml(promo.id)}" title="I-share ang promo link">
            ${icon(Icons.Share2, 'share-icon-svg', 14)} <span>I-share</span>
          </button>
          ${action}
        </div>
      </div>
    </article>
  `;
}

function renderPromoRequestPanel(promotionId: string): string {
  const promo = state.publicData?.promotions.find((item) => item.id === promotionId);
  if (!promo || !state.profile) return '';
  const documentRequired = promo.requiresStudentDocument && !state.profile.hasStudentDocument;
  const isVoucher = promo.fulfillmentType === 'voucher';
  return `
    <form class="inline-request-card" id="promo-request-form" data-promotion-id="${escapeHtml(promo.id)}">
      <div class="inline-request-head">
        <div class="inline-head-title">
          <span class="badge-claim">${icon(Icons.Gift, 'badge-icon-svg', 13)} ${isVoucher ? 'CLAIM VOUCHER' : 'CONFIRM CLAIM'}</span>
          <h3>${escapeHtml(promo.name)}</h3>
          <p>${isVoucher ? 'I-confirm ang claim para makuha agad ang iyong voucher code.' : 'I-review ang iyong detalye bago ipadala sa branch admin.'}</p>
        </div>
        <button class="close-btn-modern" type="button" data-action="cancel-promo-request" aria-label="Close request form">${icon(Icons.X, 'close-icon-svg', 16)}</button>
      </div>
      
      <div class="request-summary-grid">
        <div class="summary-chip"><span>Pangalan</span><strong>${escapeHtml(state.profile.name)}</strong></div>
        <div class="summary-chip"><span>Device ID</span><strong>${escapeHtml(state.profile.deviceId)}</strong></div>
        <div class="summary-chip"><span>Branch</span><strong>${escapeHtml(state.profile.branchName)}</strong></div>
      </div>
      
      ${documentRequired ? `
        <label class="field field-wide">
          <span class="field-label">${icon(Icons.GraduationCap, 'field-icon-svg', 16)} School ID / Student ID <b>*</b></span>
          <div class="custom-file-dropzone">
            <input name="studentDocument" type="file" accept="image/jpeg,image/png,image/webp" required class="file-input-overlay" id="promoStudentDoc" />
            <div class="dropzone-inner">
              <div class="dropzone-icon-box">${icon(Icons.UploadCloud, 'dropzone-cloud-icon', 22)}</div>
              <div class="dropzone-texts">
                <strong class="dropzone-main-text">Pumili ng litrato ng iyong School ID</strong>
                <span class="dropzone-sub-text file-chosen-name">JPG, PNG, o WebP (Max 5 MB) • Required para ma-verify ang student discount</span>
              </div>
            </div>
          </div>
        </label>
      ` : `
        <div class="document-confirm-box">
          <span class="confirm-icon-badge">${icon(Icons.CheckCircle2, 'confirmed-icon-svg', 16)}</span>
          <span>${state.profile.hasStudentDocument ? 'Naka-save at verified na ang iyong School ID.' : 'Walang karagdagang document na kailangan para sa promo na ito.'}</span>
        </div>
      `}
      
      <div class="inline-actions-row">
        <button class="btn-secondary-modern" type="button" data-action="cancel-promo-request">Kanselahin</button>
        <button class="primary-action action-glow" type="submit"><span>${isVoucher ? 'Kunin ang Voucher Code' : 'I-send ang Request'}</span> <span class="action-arrow" aria-hidden="true">${icon(Icons.Send, 'send-icon-svg', 15)}</span></button>
      </div>
    </form>
  `;
}

function renderRequestStatus(request: PromoRequest): string {
  const isApproved = request.status === 'approved';
  const isRejected = request.status === 'rejected';
  const badgeClass = isApproved ? 'status-pill-approved' : isRejected ? 'status-pill-rejected' : 'status-pill-pending';
  const statusIcon = isApproved ? icon(Icons.CheckCircle2, 'status-svg', 13) : isRejected ? icon(Icons.AlertCircle, 'status-svg', 13) : icon(Icons.Clock, 'status-svg', 13);
  return `
    <div class="status-item-card" style="flex-direction: column; align-items: stretch; gap: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px;">
        <div class="status-item-info">
          <strong class="status-item-title">${escapeHtml(request.promotionName)}</strong>
          <span class="status-item-meta">${icon(Icons.MapPin, 'status-pin-svg', 12)} ${escapeHtml(request.branchName)} • ${formatDate(request.createdAt)}</span>
        </div>
        <span class="status-pill ${badgeClass}">${statusIcon} ${statusLabel(request.status)}</span>
      </div>

      ${request.voucherCode ? `
        <div style="padding: 8px 12px; border-radius: var(--radius-xs); background: #050b14; border: 1px dashed rgba(249, 115, 22, 0.4); display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 0.72rem; color: var(--ink-muted); font-weight: 700;">VOUCHER:</span>
          <strong style="font-family: ui-monospace, monospace; color: #fdba74; font-size: 0.96rem;">${escapeHtml(request.voucherCode)}</strong>
          <button class="btn-copy-chip" type="button" data-action="copy-id" data-copy-value="${escapeHtml(request.voucherCode)}">
            ${icon(Icons.Copy, 'icon-xs', 11)} <span>Copy</span>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderIssueWorkspace(): string {
  const issues = state.publicData?.issues ?? [];
  return `
    <div class="workspace-grid issue-grid">
      <section class="workspace-column">
        <div class="section-heading"><div><p class="section-code">ISSUE REPORT</p><h2>Ano ang problema?</h2></div><span class="count-mark">${String(issues.length).padStart(2, '0')}</span></div>
        ${state.issueComposer ? renderIssueForm(state.issueComposer) : renderIssueChoices()}
      </section>
      <aside class="status-column">
        <div class="section-heading"><div><p class="section-code">MY REPORTS</p><h2>Status</h2></div><span class="count-mark">${String(issues.length).padStart(2, '0')}</span></div>
        ${issues.length ? `<div class="status-list">${issues.map(renderIssueStatus).join('')}</div>` : renderEmptyState('Wala pang report.', 'Lalabas dito ang issue history mo.', true)}
      </aside>
    </div>
  `;
}

function renderIssueChoices(): string {
  return `
    <div class="issue-choice-grid">
      <button class="issue-choice-card" type="button" data-action="choose-issue" data-issue-type="ghost_credit">
        <div class="choice-card-head">
          <span class="choice-icon-badge">${icon(Icons.Coins, 'choice-icon-svg', 22)}</span>
          <span class="choice-tag">Karaniwang Concern</span>
        </div>
        <strong class="choice-title">Ghost Credit Concern</strong>
        <p class="choice-desc">Nahulugan o nagbayad ng barya pero mas mababa o hindi pumasok ang tamang oras o credit.</p>
        <span class="choice-btn-fake">I-report ang Ghost Credit ${icon(Icons.ArrowRight, 'choice-arrow-svg', 14)}</span>
      </button>
      
      <button class="issue-choice-card" type="button" data-action="choose-issue" data-issue-type="lost_points">
        <div class="choice-card-head">
          <span class="choice-icon-badge">${icon(Icons.Timer, 'choice-icon-svg', 22)}</span>
          <span class="choice-tag">Points Concern</span>
        </div>
        <strong class="choice-title">Nawalang Points</strong>
        <p class="choice-desc">Biglang nabawasan, na-reset, o hindi pumasok ang naipong points sa iyong account.</p>
        <span class="choice-btn-fake">I-report ang Nawalang Points ${icon(Icons.ArrowRight, 'choice-arrow-svg', 14)}</span>
      </button>
    </div>
  `;
}

function renderIssueForm(issueType: IssueType): string {
  const ghost = issueType === 'ghost_credit';
  return `
    <form class="issue-form-card" id="issue-form" data-issue-type="${issueType}">
      <div class="inline-request-head">
        <div class="inline-head-title">
          <span class="badge-claim">${icon(Icons.Wrench, 'badge-icon-svg', 13)} ${ghost ? 'GHOST CREDIT REPORT' : 'LOST POINTS REPORT'}</span>
          <h3>${ghost ? 'Mag-report ng Kulang o Nawalang Credit' : 'Ilang Points ang Nawala?'}</h3>
          <p>Ilagay ang eksaktong detalye para ma-check at ma-verify ng admin.</p>
        </div>
        <button class="close-btn-modern" type="button" data-action="cancel-issue" aria-label="Close issue form">${icon(Icons.X, 'close-icon-svg', 16)}</button>
      </div>
      
      ${ghost ? `
        <div class="field-grid">
          <label class="field">
            <span class="field-label">${icon(Icons.Tag, 'field-icon-svg', 14)} Unit <b>*</b></span>
            <div class="select-wrapper">
              <select name="unit" class="input-modern select-modern">
                <option value="money">Pera (Pesos)</option>
                <option value="time">Oras (Minuto / Oras)</option>
                <option value="coins">Barya (Tokens)</option>
              </select>
            </div>
          </label>
          <div class="field-empty"></div>
          
          <label class="field">
            <span class="field-label">${icon(Icons.DollarSign, 'field-icon-svg', 14)} Nailagay / Nahulog <b>*</b></span>
            <input name="amountInserted" type="number" min="0.01" step="0.01" placeholder="10" required class="input-modern" />
          </label>
          
          <label class="field">
            <span class="field-label">${icon(Icons.Coins, 'field-icon-svg', 14)} Na-credit sa Screen <b>*</b></span>
            <input name="amountCredited" type="number" min="0" step="0.01" placeholder="7" required class="input-modern" />
          </label>
        </div>
        <p class="form-helper-tip">${icon(Icons.Info, 'tip-icon-svg', 13)} <b>Halimbawa:</b> ₱10 ang naihulog mo sa vendo, pero ₱7 lang ang pumasok na oras/credit.</p>
      ` : `
        <label class="field field-wide">
          <span class="field-label">${icon(Icons.Activity, 'field-icon-svg', 14)} Bilang ng Nawalang Points <b>*</b></span>
          <input name="pointsLost" type="number" min="1" step="1" placeholder="5" required class="input-modern" />
        </label>
        <p class="form-helper-tip">${icon(Icons.Info, 'tip-icon-svg', 13)} Ilagay ang tinatayang bilang ng points na nawala o nabawas nang hindi inaasahan.</p>
      `}
      
      <label class="field field-wide">
        <span class="field-label">${icon(Icons.FileText, 'field-icon-svg', 14)} Karagdagang Detalye <em>(Optional)</em></span>
        <textarea name="description" rows="3" maxlength="500" placeholder="Maikling paliwanag kung ano ang nangyari..." class="input-modern textarea-modern"></textarea>
      </label>
      
      <div class="request-summary-grid">
        <div class="summary-chip"><span>Device ID</span><strong>${escapeHtml(state.profile?.deviceId)}</strong></div>
        <div class="summary-chip"><span>Branch</span><strong>${escapeHtml(state.profile?.branchName)}</strong></div>
      </div>
      
      <div class="inline-actions-row">
        <button class="btn-secondary-modern" type="button" data-action="cancel-issue">Kanselahin</button>
        <button class="primary-action action-glow" type="submit"><span>I-send ang Report</span> <span class="action-arrow" aria-hidden="true">${icon(Icons.Send, 'send-icon-svg', 15)}</span></button>
      </div>
    </form>
  `;
}

function renderIssueStatus(issue: Issue): string {
  const detail = issue.issueType === 'ghost_credit'
    ? `${unitLabel(issue.unit)} • ${issue.amountInserted ?? '—'} nailagay / ${issue.amountCredited ?? '—'} na-credit`
    : `${issue.pointsLost ?? '—'} points nawala`;
  const isApproved = issue.status === 'approved';
  const isRejected = issue.status === 'rejected';
  const badgeClass = isApproved ? 'status-pill-approved' : isRejected ? 'status-pill-rejected' : 'status-pill-pending';
  const statusIcon = isApproved ? icon(Icons.CheckCircle2, 'status-svg', 13) : isRejected ? icon(Icons.AlertCircle, 'status-svg', 13) : icon(Icons.Clock, 'status-svg', 13);
  return `
    <div class="status-item-card">
      <div class="status-item-info">
        <strong class="status-item-title">${escapeHtml(issue.issueLabel)}</strong>
        <span class="status-item-meta">${escapeHtml(detail)}</span>
        <span class="status-item-time">${icon(Icons.Clock, 'time-icon-svg', 12)} ${formatDate(issue.createdAt)}</span>
      </div>
      <span class="status-pill ${badgeClass}">${statusIcon} ${statusLabel(issue.status)}</span>
    </div>
  `;
}

function renderEmptyState(title: string, body: string, showRefresh = false): string {
  return `
    <div class="empty-state-card">
      <span class="empty-state-icon">${icon(Icons.Inbox, 'empty-icon-svg', 32)}</span>
      <strong class="empty-state-title">${escapeHtml(title)}</strong>
      <p class="empty-state-desc">${escapeHtml(body)}</p>
      ${showRefresh ? `<button class="btn-secondary-modern empty-state-refresh" type="button" data-action="refresh-public" ${state.loading ? 'disabled' : ''}>${icon(Icons.RefreshCw, 'empty-refresh-icon', 15)} <span>I-sync ulit ang room</span></button>` : ''}
    </div>
  `;
}

function adminTabTitle(): string {
  return {
    overview: 'Operations Overview',
    promos: 'Promotion Management',
    requests: 'Promo Claims Queue',
    issues: 'Connection & Credit Issues',
    branches: 'Branch Locations & Lanes',
  }[state.adminTab];
}

function adminTabSubtitle(): string {
  return {
    overview: 'Monitor incoming requests, operational metrics, and recent administrative audit actions.',
    promos: 'Configure promotions, allocate branch capacity limits, and publish discounts to client hubs.',
    requests: 'Review customer promotion claims, verify attached student IDs, and copy Device IDs for fulfillment.',
    issues: 'Inspect reported vending issues, ghost credits, and lost points reports submitted by connected users.',
    branches: 'Manage active PisoWiFi vending locations and toggle onboarding availability.',
  }[state.adminTab];
}

function adminAudienceLabel(audience: Audience): string {
  return audience === 'students' ? 'Students Only (ID Required)' : 'General Public (Everyone)';
}

function adminUnitLabel(unit: CreditUnit | null): string {
  if (unit === 'money') return 'Pesos (Cash)';
  if (unit === 'time') return 'Time (Minutes / Hours)';
  if (unit === 'coins') return 'Coins / Tokens';
  return '—';
}

function renderAdminLogin(): string {
  return `
    <main class="admin-login-page">
      <div class="admin-login-frame">
        <header class="onboarding-header">
          ${renderBrand(true)}
          <a class="back-link" href="#/">${icon(Icons.ArrowRight, 'back-arrow-flipped', 13)} <span>Back to Customer Hub</span></a>
        </header>
        ${renderNotice()}
        ${hasBackendConfig && hasAdminAuthConfig ? '' : renderConfigNotice()}
        <section class="admin-login-grid">
          <div class="admin-login-hero">
            <span class="admin-badge-desk">${icon(Icons.ShieldCheck, 'lock-svg', 14)} <span>ADMINISTRATION DESK</span></span>
            <h1>Operations Control Desk</h1>
            <p class="intro-copy">Manage branch promotions, review customer claims, inspect issue reports, and configure vending capacities for DXTECH PisoWiFi Hub.</p>
          </div>
          <form class="form-panel login-form-card" id="admin-login-form">
            <div class="panel-heading">
              <span class="panel-pill">SECURE ACCESS</span>
              <h2>Sign In to Console</h2>
            </div>
            <div class="field-grid">
            <label class="admin-field">
              <span class="admin-label">Admin Email <b>*</b></span>
              <input name="email" type="email" autocomplete="username" value="${escapeHtml(state.adminPrefillEmail || '')}" placeholder="admin@example.com" required class="admin-input" />
            </label>

            <label class="admin-field">
              <span class="admin-label">Password <b>*</b></span>
              <input name="password" type="password" autocomplete="current-password" value="${escapeHtml(state.adminPrefillPassword || '')}" placeholder="••••••••••••" required class="admin-input" />
            </label>
            </div>
            <button class="primary-action action-wide action-hero" type="submit" ${state.loading || !hasBackendConfig || !hasAdminAuthConfig ? 'disabled' : ''}>
              <span>${state.loading ? 'Signing In…' : 'Sign In to Console'}</span>
              <span class="action-arrow" aria-hidden="true">${icon(Icons.ArrowRight, 'btn-arrow-svg', 18)}</span>
            </button>
          </form>
        </section>
      </div>
    </main>
  `;
}

function renderAdminShell(): string {
  const data = state.adminData;
  if (!data) return `<main class="loading-page"><div class="loading-block"><span class="loading-spinner"></span> Loading Administrator Console…</div></main>`;
  const userEmail = state.adminSession?.user.email || 'Administrator';
  const initial = userEmail.charAt(0).toUpperCase() || 'A';
  return `
    <main class="admin-layout">
      <aside class="admin-rail">
        <div class="admin-rail-top">
          ${renderBrand(true)}
          <span class="admin-badge-desk">${icon(Icons.ShieldCheck, 'desk-shield-icon', 12)} ADMIN</span>
        </div>
        <div class="admin-rail-title">
          <p class="section-code">DXTECH CONTROL</p>
          <h1>Operations Desk</h1>
        </div>
        <nav class="admin-nav" aria-label="Admin navigation">
          ${renderAdminNavButton('overview', 'Overview', '01', Icons.Layers)}
          ${renderAdminNavButton('promos', 'Promotions', '02', Icons.Gift)}
          ${renderAdminNavButton('requests', 'Claims Queue', '03', Icons.Inbox, data.summary.pendingPromoRequests)}
          ${renderAdminNavButton('issues', 'Issue Reports', '04', Icons.Wrench, data.summary.pendingIssues)}
          ${renderAdminNavButton('branches', 'Branches', '05', Icons.Building)}
        </nav>
        <div class="admin-rail-foot">
          <div class="admin-user-card">
            <div class="admin-avatar">${escapeHtml(initial)}</div>
            <div class="admin-user-info">
              <strong class="admin-user-email">${escapeHtml(userEmail)}</strong>
              <span class="admin-user-role">System Administrator</span>
            </div>
          </div>
          <button class="btn-admin-logout" type="button" data-action="admin-logout">
            ${icon(Icons.LogOut, 'logout-icon-svg', 14)} <span>Sign Out</span>
          </button>
        </div>
      </aside>
      <section class="admin-main">
        <header class="admin-header">
          <div class="admin-header-title-box">
            <p class="section-code">OPERATIONS / ${escapeHtml(state.adminTab.toUpperCase())}</p>
            <h2>${adminTabTitle()}</h2>
            <p class="admin-header-subtitle">${adminTabSubtitle()}</p>
          </div>
          <div class="admin-header-actions">
            <div class="header-status-pill"><span class="live-dot"></span><span>Live Connected</span></div>
            <button class="btn-admin-refresh" type="button" data-action="refresh-admin" aria-label="Refresh data">
              ${icon(Icons.RefreshCw, 'refresh-icon', 14)} <span>Sync Data</span>
            </button>
          </div>
        </header>
        ${renderNotice()}
        ${renderAdminTab(data)}
        ${renderVoucherInventoryModal()}
      </section>
    </main>
  `;
}

function renderAdminNavButton(tab: AdminTab, label: string, index: string, iconNode: typeof Icons[keyof typeof Icons], count = 0): string {
  return `
    <button type="button" class="admin-nav-button ${state.adminTab === tab ? 'is-active' : ''}" data-action="admin-tab" data-tab="${tab}">
      <span class="nav-btn-left">
        <span class="nav-index-chip">${index}</span>
        ${icon(iconNode, 'nav-tab-icon', 16)}
        <span>${label}</span>
      </span>
      ${count ? `<b class="nav-badge">${count}</b>` : ''}
    </button>
  `;
}

function renderAdminTab(data: AdminData): string {
  if (state.adminTab === 'promos') return renderAdminPromos(data);
  if (state.adminTab === 'requests') return renderAdminRequests(data);
  if (state.adminTab === 'issues') return renderAdminIssues(data);
  if (state.adminTab === 'branches') return renderAdminBranches(data);
  return renderAdminOverview(data);
}

function renderAdminOverview(data: AdminData): string {
  const recentRequests = [...data.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  return `
    <section class="admin-content">
      <div class="admin-stat-grid">
        <div class="admin-stat-card">
          <div class="stat-card-head">
            <span class="stat-card-icon">${icon(Icons.Inbox, 'stat-icon', 20)}</span>
            <span class="stat-card-tag tag-pending">Needs Action</span>
          </div>
          <span class="stat-card-label">Pending Claims</span>
          <strong class="stat-card-value">${data.summary.pendingPromoRequests}</strong>
          <span class="stat-card-subtext">Promo requests awaiting review</span>
        </div>

        <div class="admin-stat-card">
          <div class="stat-card-head">
            <span class="stat-card-icon">${icon(Icons.Wrench, 'stat-icon', 20)}</span>
            <span class="stat-card-tag tag-pending">Needs Action</span>
          </div>
          <span class="stat-card-label">Pending Issues</span>
          <strong class="stat-card-value">${data.summary.pendingIssues}</strong>
          <span class="stat-card-subtext">Unresolved user problem reports</span>
        </div>

        <div class="admin-stat-card">
          <div class="stat-card-head">
            <span class="stat-card-icon">${icon(Icons.Gift, 'stat-icon', 20)}</span>
            <span class="stat-card-tag tag-active">Live</span>
          </div>
          <span class="stat-card-label">Active Promos</span>
          <strong class="stat-card-value">${data.summary.activePromotions}</strong>
          <span class="stat-card-subtext">Visible on customer hubs</span>
        </div>

        <div class="admin-stat-card">
          <div class="stat-card-head">
            <span class="stat-card-icon">${icon(Icons.Bell, 'stat-icon', 20)}</span>
            <span class="stat-card-tag tag-subscribers">Enrolled</span>
          </div>
          <span class="stat-card-label">Subscribers</span>
          <strong class="stat-card-value">${data.summary.notificationSubscribers}</strong>
          <span class="stat-card-subtext">Enrolled for browser alerts</span>
        </div>
      </div>

      <div class="admin-overview-grid">
        <section class="admin-panel">
          <div class="admin-panel-head">
            <div class="admin-panel-title-group">
              <p class="section-code">RECENT QUEUE</p>
              <h3>Incoming Promo Claims</h3>
            </div>
            <button class="text-action" type="button" data-action="admin-tab" data-tab="requests">View All Queue ↗</button>
          </div>
          ${recentRequests.length ? `
            <div class="admin-mini-list">
              ${recentRequests.map((request) => `
                <div class="admin-mini-row">
                  <div>
                    <strong>${escapeHtml(request.name)}</strong>
                    <span>${escapeHtml(request.promotionName)} · ${escapeHtml(request.branchName)} (ID: ${escapeHtml(request.deviceId)})</span>
                  </div>
                  <span class="${statusClass(request.status)}">${statusLabel(request.status)}</span>
                </div>
              `).join('')}
            </div>
          ` : renderEmptyState('No recent requests.', 'Incoming promo claims from users will appear here.')}
        </section>

        <div class="admin-sidebar-column" style="display: grid; gap: 24px;">
          <section class="admin-panel">
            <div class="admin-panel-head">
              <div class="admin-panel-title-group">
                <p class="section-code">QUICK ACTION</p>
                <h3>Create New Promo</h3>
              </div>
            </div>
            <p class="panel-copy" style="color: var(--ink-soft); font-size: 0.88rem; line-height: 1.5; margin-bottom: 16px;">
              Publish a new discount or student speed pass, set branch slot quotas, and notify subscribed users.
            </p>
            <button class="primary-action action-wide" type="button" data-action="new-promo">
              <span>Create Promotion</span>
              <span class="action-arrow" aria-hidden="true">${icon(Icons.ArrowRight, 'btn-icon-svg', 16)}</span>
            </button>
          </section>

          <section class="admin-panel">
            <div class="admin-panel-head">
              <div class="admin-panel-title-group">
                <p class="section-code">AUDIT LOG</p>
                <h3>Recent Activity</h3>
              </div>
              <span class="panel-index">${data.auditLogs.length} events</span>
            </div>
            ${data.auditLogs.length ? `
              <div class="admin-audit-list">
                ${data.auditLogs.slice(0, 5).map((log) => `
                  <div class="admin-audit-item">
                    <div class="audit-action-info">
                      <span class="audit-action-icon">${icon(Icons.CheckCircle2, 'log-check', 14)}</span>
                      <div class="audit-action-text">
                        <strong>${escapeHtml(log.action.replaceAll('_', ' ').toUpperCase())}</strong>
                        <span>${escapeHtml(log.targetType)}${log.targetId ? ` · Ref: ${escapeHtml(log.targetId.slice(0, 8).toUpperCase())}` : ''}</span>
                      </div>
                    </div>
                    <time class="audit-timestamp">${formatDate(log.createdAt)}</time>
                  </div>
                `).join('')}
              </div>
            ` : renderEmptyState('No audit activity yet.', 'Administrative actions will be recorded here.')}
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderSpreadsheetMapper(parsed: SpreadsheetParseResult): string {
  const branches = state.adminData?.branches || [];
  const headers = parsed.headers;
  const mapping = state.importerMapping;
  const selectedBranch = state.importerSelectedBranchId !== 'all' ? state.importerSelectedBranchId : undefined;
  const processed = applyColumnMapping(
    parsed,
    mapping,
    branches,
    selectedBranch,
    state.importerFallbackDuration
  );

  const previewStart = Math.max(0, parsed.dataStartRowIndex);
  const previewRows = parsed.matrix.slice(previewStart, previewStart + 5);
  const totalRows = parsed.matrix.length;

  return `
    <div class="column-mapper-card">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
        <div>
          <strong style="font-size: 0.88rem; color: #ffffff;">Spreadsheet Mapping & Branch Extraction</strong>
          <p style="font-size: 0.76rem; color: var(--ink-muted); margin: 2px 0 0 0;">Adjust header row, data start, and branch columns for router CSB/XLSX exports.</p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="importer-stat-chip ${processed.duplicateCount ? 'is-warn' : ''}">
            ${processed.validCount} valid codes ${processed.duplicateCount ? `(${processed.duplicateCount} dupes skipped)` : ''}
          </span>
          ${processed.unresolvedBranchCount > 0 ? `
            <span class="importer-stat-chip is-warn">
              ${processed.unresolvedBranchCount} missing branch
            </span>
          ` : ''}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-top: 14px; padding: 12px; background: rgba(0,0,0,0.25); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
        <label class="admin-field">
          <span class="admin-label">Table Header Row <b>*</b></span>
          <select data-importer-config="header-row" class="admin-select" style="min-height: 38px;">
            <option value="-1" ${parsed.headerRowIndex === -1 ? 'selected' : ''}>-- No Header Row (Col 1, 2...) --</option>
            ${Array.from({ length: Math.min(10, totalRows) }, (_, i) => `
              <option value="${i}" ${parsed.headerRowIndex === i ? 'selected' : ''}>Row #${i + 1}${parsed.matrix[i] ? `: ${escapeHtml(parsed.matrix[i].slice(0, 3).join(', ')).slice(0, 40)}` : ''}</option>
            `).join('')}
          </select>
          <small class="admin-field-hint">Defines column names</small>
        </label>

        <label class="admin-field">
          <span class="admin-label">Data Records Start Row <b>*</b></span>
          <select data-importer-config="start-row" class="admin-select" style="min-height: 38px;">
            ${Array.from({ length: Math.min(12, totalRows) }, (_, i) => `
              <option value="${i}" ${parsed.dataStartRowIndex === i ? 'selected' : ''}>Start at Row #${i + 1}${parsed.matrix[i] ? `: ${escapeHtml(parsed.matrix[i].slice(0, 2).join(', ')).slice(0, 30)}` : ''}</option>
            `).join('')}
          </select>
          <small class="admin-field-hint">Skips title preambles</small>
        </label>
      </div>

      <div class="mapper-selectors-grid" style="margin-top: 12px;">
        <label class="admin-field">
          <span class="admin-label">Voucher Code Column <b>*</b></span>
          <select data-mapper="code" class="admin-select" style="min-height: 38px;">
            ${headers.map((h, i) => `<option value="${i}" ${mapping.codeColIndex === i ? 'selected' : ''}>[Col ${i + 1}] ${escapeHtml(h)}</option>`).join('')}
          </select>
        </label>

        <label class="admin-field">
          <span class="admin-label">Duration / Time Column</span>
          <select data-mapper="time" class="admin-select" style="min-height: 38px;">
            <option value="-1" ${mapping.timeColIndex === -1 ? 'selected' : ''}>-- None / Use Fallback --</option>
            ${headers.map((h, i) => `<option value="${i}" ${mapping.timeColIndex === i ? 'selected' : ''}>[Col ${i + 1}] ${escapeHtml(h)}</option>`).join('')}
          </select>
        </label>

        <label class="admin-field">
          <span class="admin-label">Branch / Site Column</span>
          <select data-mapper="branch" class="admin-select" style="min-height: 38px;">
            <option value="-1" ${mapping.branchColIndex === -1 ? 'selected' : ''}>-- None (Use Selected Branch Below) --</option>
            ${headers.map((h, i) => `<option value="${i}" ${mapping.branchColIndex === i ? 'selected' : ''}>[Col ${i + 1}] ${escapeHtml(h)}</option>`).join('')}
          </select>
        </label>

        <label class="admin-field">
          <span class="admin-label">Plan / Profile Column</span>
          <select data-mapper="label" class="admin-select" style="min-height: 38px;">
            <option value="-1" ${mapping.labelColIndex === -1 ? 'selected' : ''}>-- None / Skip --</option>
            ${headers.map((h, i) => `<option value="${i}" ${mapping.labelColIndex === i ? 'selected' : ''}>[Col ${i + 1}] ${escapeHtml(h)}</option>`).join('')}
          </select>
        </label>
      </div>

      ${processed.detectedBranches.length ? `
        <div style="margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
          <span style="font-size: 0.76rem; color: var(--ink-muted);">Resolved Branch Distribution:</span>
          ${processed.detectedBranches.map((b) => `
            <span class="badge-status status-approved" style="font-size: 0.72rem;">
              ${escapeHtml(b.branchName)}: <b>${b.count}</b>
            </span>
          `).join('')}
        </div>
      ` : ''}

      <div class="mapper-preview-wrap" style="margin-top: 14px;">
        <table class="mapper-preview-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Extracted Voucher Code</th>
              <th>Mapped Duration</th>
              <th>Associated Branch</th>
            </tr>
          </thead>
          <tbody>
            ${previewRows.length ? previewRows.map((row, idx) => {
              const rowIndex = previewStart + idx;
              const code = normalizeVoucherCode(mapping.codeColIndex >= 0 && mapping.codeColIndex < row.length ? row[mapping.codeColIndex] : '');
              const duration = mapping.timeColIndex >= 0 && mapping.timeColIndex < row.length && row[mapping.timeColIndex] ? row[mapping.timeColIndex] : (state.importerFallbackDuration || '—');
              const rawBranch = mapping.branchColIndex >= 0 && mapping.branchColIndex < row.length ? row[mapping.branchColIndex] : undefined;
              const resBranch = branches.length ? applyColumnMapping(
                { ...parsed, matrix: [row], dataStartRowIndex: 0 },
                mapping,
                branches,
                selectedBranch
              ).vouchers[0]?.branchName : undefined;
              const displayBranch = resBranch || (selectedBranch ? (branches.find((b) => b.id === selectedBranch)?.name || 'Selected Branch') : 'All Branches (Global)');

              return `
                <tr>
                  <td>#${rowIndex + 1}</td>
                  <td><strong style="color: #fdba74;">${escapeHtml(code || '(empty)')}</strong></td>
                  <td>${escapeHtml(duration || '—')}</td>
                  <td>
                    <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; color: ${resBranch ? '#86efac' : '#93c5fd'};">
                      ${escapeHtml(displayBranch)}
                    </span>
                  </td>
                </tr>
              `;
            }).join('') : `
              <tr>
                <td colspan="4" style="text-align: center; color: var(--ink-muted); padding: 16px;">
                  No records found starting at Row #${previewStart + 1}. Check the Data Records Start Row setting.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderVoucherInventoryModal(): string {
  const promoId = state.voucherModalPromotionId;
  if (!promoId) return '';
  const promo = state.adminData?.promotions.find((p) => p.id === promoId);
  const vouchers = state.voucherModalList;
  const filtered = (vouchers || []).filter((v) => {
    const q = state.voucherSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      v.code.toLowerCase().includes(q) ||
      (v.assignedName && v.assignedName.toLowerCase().includes(q)) ||
      (v.assignedDevice && v.assignedDevice.toLowerCase().includes(q)) ||
      v.branchName.toLowerCase().includes(q)
    );
  });
  return `
    <div class="modal-backdrop" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); z-index: 1000; overflow-y: auto; padding: 20px; display: flex; align-items: center; justify-content: center;">
      <section class="voucher-drawer-card" aria-labelledby="voucher-inventory-title" style="width: 100%; max-width: 860px; position: relative;">
        <div class="admin-panel-head">
          <div class="admin-panel-title-group">
            <p class="section-code">VOUCHER INVENTORY POOL</p>
            <h3 id="voucher-inventory-title">${escapeHtml(promo?.name || 'Promotion')} - Voucher Codes</h3>
          </div>
          <button class="close-btn-modern" type="button" data-action="close-voucher-drawer" aria-label="Close inventory">${icon(Icons.X, 'close-svg', 16)}</button>
        </div>

        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 16px;">
          <input data-filter="voucher-search" placeholder="Search by code, customer name, device ID, or branch..." value="${escapeHtml(state.voucherSearchQuery)}" class="admin-input" style="flex: 1;" />
          <button class="primary-action" type="button" data-action="edit-promo" data-promotion-id="${escapeHtml(promoId)}" style="white-space: nowrap;">
            ${icon(Icons.UploadCloud, 'btn-icon-svg', 15)} <span>Import More</span>
          </button>
        </div>

        ${state.voucherModalLoading ? `
          <div class="loading-block"><span class="loading-spinner"></span> Loading voucher inventory…</div>
        ` : `
          <div class="admin-table-wrap" style="max-height: 420px; overflow-y: auto;">
            <table class="admin-data-table">
              <thead>
                <tr>
                  <th>Voucher Code</th>
                  <th>Duration</th>
                  <th>Branch</th>
                  <th>Assignment Status</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.length ? filtered.map((v) => `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <strong style="font-family: ui-monospace, monospace; color: #fdba74;">${escapeHtml(v.code)}</strong>
                        <button class="btn-copy-chip" type="button" data-action="copy-id" data-copy-value="${escapeHtml(v.code)}">${icon(Icons.Copy, 'icon-xs', 11)}</button>
                      </div>
                    </td>
                    <td>${escapeHtml(v.durationLabel || 'Standard')}</td>
                    <td>${escapeHtml(v.branchName)}</td>
                    <td>
                      ${v.assignedProfileId ? `
                        <span class="badge-status status-approved" style="font-size: 0.74rem;">
                          ${icon(Icons.CheckCircle2, 'icon-xs', 11)} Claimed by ${escapeHtml(v.assignedName || 'User')} (${escapeHtml(v.assignedDevice || 'ID')})
                        </span>
                      ` : `
                        <span class="badge-status tag-active" style="font-size: 0.74rem;">
                          ${icon(Icons.Tag, 'icon-xs', 11)} Available in Stock
                        </span>
                      `}
                    </td>
                    <td><time>${formatDate(v.assignedAt || v.createdAt)}</time></td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td colspan="5" style="text-align: center; padding: 30px; color: var(--ink-muted);">
                      No voucher codes match your search.
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        `}

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line);">
          <span style="font-size: 0.8rem; color: var(--ink-muted);">Total codes: <b>${vouchers?.length || 0}</b> • Unassigned: <b>${vouchers?.filter((v) => !v.assignedProfileId).length || 0}</b></span>
          <button class="btn-secondary-modern" type="button" data-action="close-voucher-drawer">Close</button>
        </div>
      </section>
    </div>
  `;
}

function renderAdminPromos(data: AdminData): string {
  const editing = data.promotions.find((promo) => promo.id === state.editingPromotionId) || null;
  const isVoucher = state.editingFulfillmentType === 'voucher';
  const parsedPaste = parseRawVoucherText(
    state.importerTextDraft,
    state.importerFallbackDuration,
    state.importerSelectedBranchId !== 'all' ? state.importerSelectedBranchId : undefined,
    data.branches
  );

  const slots = data.branches.map((branch) => {
    const slot = editing?.slots.find((item) => item.branchId === branch.id);
    return `
      <div class="slot-branch-item">
        <span class="slot-branch-name">${icon(Icons.MapPin, 'branch-icon', 14)} ${escapeHtml(branch.name)}</span>
        <div class="slot-input-control">
          <span>Capacity:</span>
          <input name="slot-${escapeHtml(branch.id)}" type="number" min="0" step="1" value="${slot?.capacity ?? 0}" required class="slot-number-input" />
        </div>
      </div>
    `;
  }).join('');

  return `
    <section class="admin-content">
      <div class="admin-two-column">
        <form class="admin-panel promo-editor" id="admin-promo-form">
          <div class="admin-panel-head">
            <div class="admin-panel-title-group">
              <p class="section-code">${editing ? 'EDIT PROMO' : 'NEW PROMOTION'}</p>
              <h3>${editing ? `Edit: ${escapeHtml(editing.name)}` : 'Create New Promotion'}</h3>
            </div>
            ${editing ? `<button class="close-btn-modern" type="button" data-action="cancel-promo-edit" aria-label="Cancel edit">${icon(Icons.X, 'close-svg', 16)}</button>` : '<span class="panel-pill">PROMO BUILDER</span>'}
          </div>

          <div class="admin-form-stage">
            <label class="admin-field admin-field-wide">
              <span class="admin-label">Promotion Title <b>*</b></span>
              <input name="name" maxlength="160" value="${escapeHtml(editing?.name || '')}" placeholder="e.g. Student 50% Speed Booster" required class="admin-input" />
            </label>

            <label class="admin-field admin-field-wide">
              <span class="admin-label">Description / Offer Details <em>(Optional)</em></span>
              <textarea name="description" rows="3" maxlength="500" placeholder="Describe the promo perks, validity, and instructions..." class="admin-textarea">${escapeHtml(editing?.description || '')}</textarea>
            </label>

            <div class="admin-field admin-field-wide">
              <span class="admin-label">Target Audience <b>*</b></span>
              <select name="audience" class="admin-select">
                <option value="everyone" ${editing?.audience === 'everyone' || !editing ? 'selected' : ''}>General Public (Everyone)</option>
                <option value="students" ${editing?.audience === 'students' ? 'selected' : ''}>Students Only (Requires Valid School ID)</option>
              </select>
              <small class="admin-field-hint">${icon(Icons.Info, 'info-hint', 12)} Student exclusive promos automatically require customers to upload a valid School ID photo.</small>
            </div>

            <div class="admin-field admin-field-wide">
              <span class="admin-label">Fulfillment Mechanism <b>*</b></span>
              <div class="fulfillment-mode-grid">
                <label class="fulfillment-card ${!isVoucher ? 'is-selected' : ''}">
                  <input type="radio" name="fulfillmentType" value="manual_topup" ${!isVoucher ? 'checked' : ''} />
                  <div class="fulfillment-card-info">
                    <strong>Manual Operator Top-Up</strong>
                    <p>Customers submit claims into review queue. Operator credits balance manually using Device ID.</p>
                  </div>
                </label>
                <label class="fulfillment-card ${isVoucher ? 'is-selected' : ''}">
                  <input type="radio" name="fulfillmentType" value="voucher" ${isVoucher ? 'checked' : ''} />
                  <div class="fulfillment-card-info">
                    <strong>Instant Voucher Code</strong>
                    <p>Pre-generated voucher codes are automatically dispensed to qualifying customers upon claiming.</p>
                  </div>
                </label>
              </div>
            </div>

            ${isVoucher ? `
              <div class="voucher-importer-box">
                <div class="importer-mode-nav">
                  <button type="button" class="importer-tab-btn ${state.importerActiveTab === 'paste' ? 'is-active' : ''}" data-action="importer-tab" data-tab="paste">
                    ${icon(Icons.FileText, 'tab-icon', 13)} <span>Quick Paste Codes</span>
                  </button>
                  <button type="button" class="importer-tab-btn ${state.importerActiveTab === 'file' ? 'is-active' : ''}" data-action="importer-tab" data-tab="file">
                    ${icon(Icons.UploadCloud, 'tab-icon', 13)} <span>Spreadsheet File (CSV / XLSX)</span>
                  </button>
                </div>

                ${state.importerActiveTab === 'paste' ? `
                  <div class="admin-field">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                      <span class="admin-label">Paste Voucher Codes</span>
                      <span class="importer-stat-chip ${parsedPaste.duplicateCount ? 'is-warn' : ''}">${parsedPaste.validCount} valid codes detected</span>
                    </div>
                    <textarea name="voucherTextDraft" rows="4" placeholder="Paste codes here (e.g. DX-8841, DX-8842 or tab-separated)..." class="admin-textarea" style="font-family: ui-monospace, monospace;">${escapeHtml(state.importerTextDraft)}</textarea>
                    <div style="display: flex; gap: 12px; align-items: center;">
                      <input name="importerFallbackDuration" placeholder="Optional duration (e.g. 1 Hour, 5 Hours)" value="${escapeHtml(state.importerFallbackDuration)}" class="admin-input" style="flex: 1;" />
                    </div>
                    ${parsedPaste.duplicateCount > 0 ? `<small class="admin-field-hint" style="color: #fbbf24;">${icon(Icons.AlertTriangle, 'warn', 12)} Filtered out ${parsedPaste.duplicateCount} duplicate codes in this batch.</small>` : ''}
                  </div>
                ` : `
                  <div class="admin-field">
                    <span class="admin-label">Upload Router Voucher Export (.xlsx, .xls, .csv, .tsv)</span>
                    <div class="custom-file-dropzone" style="margin-bottom: 10px;">
                      <input type="file" name="voucherFile" accept=".csv,.tsv,.txt,.xlsx,.xls" class="file-input-overlay" id="voucherFileInput" />
                      <div class="dropzone-inner" style="padding: 20px;">
                        <div class="dropzone-icon-box">${icon(Icons.UploadCloud, 'cloud-icon', 22)}</div>
                        <div class="dropzone-texts">
                          <strong class="dropzone-main-text">${state.importerSpreadsheet ? `Loaded: ${escapeHtml(state.importerSpreadsheet.fileName)} (${state.importerSpreadsheet.totalRawRows} rows)` : 'Choose or drop router spreadsheet export'}</strong>
                          <span class="dropzone-sub-text">Supported: Excel (.xlsx, .xls), CSV, TSV • Auto-detects columns</span>
                        </div>
                      </div>
                    </div>

                    ${state.importerSpreadsheet ? renderSpreadsheetMapper(state.importerSpreadsheet) : ''}
                  </div>
                `}

                <div class="admin-field">
                  <span class="admin-label">Assign Vouchers To Branch</span>
                  <select name="importerSelectedBranchId" class="admin-select">
                    <option value="all" ${state.importerSelectedBranchId === 'all' ? 'selected' : ''}>All Branches (Global Pool)</option>
                    ${data.branches.map((branch) => `<option value="${escapeHtml(branch.id)}" ${state.importerSelectedBranchId === branch.id ? 'selected' : ''}>${escapeHtml(branch.name)}</option>`).join('')}
                  </select>
                </div>
              </div>
            ` : `
              <div class="slot-editor-box">
                <div class="slot-editor-header">
                  <strong>Branch Slot Quotas</strong>
                  <small>Approved claims consume slots</small>
                </div>
                <div class="slot-branches-grid">
                  ${slots || '<p class="admin-field-hint">No branches found. Create a branch first.</p>'}
                </div>
              </div>
            `}

            <div class="admin-toggles-container">
              <label class="admin-toggle-row">
                <div class="admin-toggle-info">
                  <strong>Visible to Customers</strong>
                  <span>Show this promo on customer onboarding and hub</span>
                </div>
                <div class="admin-switch">
                  <input type="checkbox" name="active" ${editing?.active !== false ? 'checked' : ''} />
                  <span class="admin-switch-slider"></span>
                </div>
              </label>

              <label class="admin-toggle-row">
                <div class="admin-toggle-info">
                  <strong>Publish Live</strong>
                  <span>Allow users to submit claim requests immediately</span>
                </div>
                <div class="admin-switch">
                  <input type="checkbox" name="published" ${editing?.published ? 'checked' : ''} />
                  <span class="admin-switch-slider"></span>
                </div>
              </label>

              <label class="admin-toggle-row">
                <div class="admin-toggle-info">
                  <strong>Notify Subscribers</strong>
                  <span>Broadcast Web Push notification upon publishing</span>
                </div>
                <div class="admin-switch">
                  <input type="checkbox" name="notifyOnPublish" ${editing?.notifyOnPublish ? 'checked' : ''} />
                  <span class="admin-switch-slider"></span>
                </div>
              </label>
            </div>

            <div class="admin-form-actions" style="display: flex; gap: 12px; margin-top: 8px;">
              ${editing ? `<button class="btn-secondary-modern" type="button" data-action="cancel-promo-edit">Cancel</button>` : ''}
              <button class="primary-action action-wide" type="submit">
                <span>${editing ? 'Save Changes' : 'Create Promotion'}</span>
                <span class="action-arrow" aria-hidden="true">${icon(Icons.ArrowRight, 'btn-icon-svg', 16)}</span>
              </button>
            </div>
          </div>
        </form>

        <section class="admin-panel">
          <div class="admin-panel-head">
            <div class="admin-panel-title-group">
              <p class="section-code">PROMOTION BOARD</p>
              <h3>Existing Promotions</h3>
            </div>
            <span class="panel-index">${data.promotions.length} total</span>
          </div>
          ${data.promotions.length ? `
            <div class="promo-admin-list">
              ${data.promotions.map(renderAdminPromotion).join('')}
            </div>
          ` : renderEmptyState('No promotions yet.', 'Create your first promotion using the form on the left.')}
        </section>
      </div>
    </section>
  `;
}

function renderAdminPromotion(promo: AdminPromotion): string {
  const totalCapacity = promo.slots.reduce((sum, slot) => sum + slot.capacity, 0);
  const available = promo.slots.reduce((sum, slot) => sum + slot.availableSlots, 0);
  const isStudent = promo.audience === 'students';
  const isVoucher = promo.fulfillmentType === 'voucher';
  return `
    <article class="admin-promo-card">
      <div class="admin-promo-head">
        <div>
          <div class="admin-promo-badges" style="margin-bottom: 6px;">
            <span class="badge-status ${isStudent ? 'badge-verified' : 'status-pill-subtle'}">${isStudent ? `${icon(Icons.GraduationCap, 'icon-xs', 12)} Students Only` : `${icon(Icons.Sparkles, 'icon-xs', 12)} General Public`}</span>
            <span class="badge-status ${isVoucher ? 'tag-subscribers' : 'status-pill-subtle'}">
              ${isVoucher ? `${icon(Icons.Tag, 'icon-xs', 12)} Instant Voucher` : `${icon(Icons.User, 'icon-xs', 12)} Manual Top-Up`}
            </span>
            <span class="badge-status ${promo.published ? 'status-approved' : 'status-pending'}">${promo.published ? 'Live Published' : 'Draft'}</span>
            <span class="badge-status ${promo.active ? 'tag-active' : 'status-rejected'}">${promo.active ? 'Active' : 'Disabled'}</span>
          </div>
          <h4>${escapeHtml(promo.name)}</h4>
        </div>
      </div>
      <p class="admin-promo-desc">${escapeHtml(promo.description || 'No additional description.')}</p>
      <div class="admin-slots-summary">
        ${promo.slots.map((slot) => `
          <div class="admin-slot-row">
            <span>${escapeHtml(slot.branchName)}</span>
            <strong>${slot.availableSlots} available / ${slot.capacity} slots</strong>
          </div>
        `).join('')}
      </div>
      <div class="admin-promo-foot">
        <span class="capacity-total" style="font-size: 0.82rem; font-weight: 700; color: #fdba74;">
          ${isVoucher
            ? `${promo.voucherUnassignedCount ?? available} in stock / ${promo.voucherTotalCount ?? totalCapacity} total vouchers`
            : `${available} total open / ${totalCapacity} capacity`}
        </span>
        <div style="display: flex; gap: 8px;">
          ${isVoucher ? `
            <button class="btn-edit-promo" type="button" data-action="view-vouchers" data-promotion-id="${escapeHtml(promo.id)}">
              ${icon(Icons.Layers, 'btn-icon-svg', 13)} <span>Vouchers (${promo.voucherTotalCount ?? 0})</span>
            </button>
          ` : ''}
          <button class="btn-edit-promo" type="button" data-action="edit-promo" data-promotion-id="${escapeHtml(promo.id)}">
            ${icon(Icons.Pencil, 'btn-icon-svg', 13)} <span>Edit</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderAdminRequests(data: AdminData): string {
  const requests = data.requests.filter((request) =>
    (state.requestStatusFilter === 'all' || request.status === state.requestStatusFilter) &&
    (state.requestBranchFilter === 'all' || request.branchId === state.requestBranchFilter) &&
    (state.requestPromotionFilter === 'all' || request.promotionId === state.requestPromotionFilter)
  );
  const selected = state.selectedRequestId ? data.requests.find((request) => request.id === state.selectedRequestId) : null;
  return `
    <section class="admin-content">
      <div class="admin-filter-bar">
        <div class="admin-filter-group">
          <span class="admin-filter-label">${icon(Icons.Activity, 'filter-icon', 12)} Status Filter</span>
          <select data-filter="request-status" class="admin-select admin-filter-select">
            <option value="pending" ${state.requestStatusFilter === 'pending' ? 'selected' : ''}>Pending Review</option>
            <option value="approved" ${state.requestStatusFilter === 'approved' ? 'selected' : ''}>Approved</option>
            <option value="rejected" ${state.requestStatusFilter === 'rejected' ? 'selected' : ''}>Rejected</option>
            <option value="all" ${state.requestStatusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
          </select>
        </div>

        <div class="admin-filter-group">
          <span class="admin-filter-label">${icon(Icons.MapPin, 'filter-icon', 12)} Branch Location</span>
          <select data-filter="request-branch" class="admin-select admin-filter-select">
            <option value="all">All Branches</option>
            ${data.branches.map((branch) => `<option value="${escapeHtml(branch.id)}" ${state.requestBranchFilter === branch.id ? 'selected' : ''}>${escapeHtml(branch.name)}</option>`).join('')}
          </select>
        </div>

        <div class="admin-filter-group">
          <span class="admin-filter-label">${icon(Icons.Gift, 'filter-icon', 12)} Promotion</span>
          <select data-filter="request-promo" class="admin-select admin-filter-select">
            <option value="all">All Promotions</option>
            ${data.promotions.map((promo) => `<option value="${escapeHtml(promo.id)}" ${state.requestPromotionFilter === promo.id ? 'selected' : ''}>${escapeHtml(promo.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <form id="bulk-review-form" class="admin-panel admin-table-panel">
        <div class="admin-table-toolbar">
          <div class="admin-panel-title-group">
            <p class="section-code">REQUEST QUEUE</p>
            <h3>${requests.length} Claim Request${requests.length === 1 ? '' : 's'}</h3>
          </div>
          <div class="admin-bulk-actions">
            <button class="btn-bulk-reject" name="reviewAction" value="rejected" type="submit" ${state.requestStatusFilter !== 'pending' ? 'disabled' : ''}>
              ${icon(Icons.X, 'btn-icon-svg', 13)} <span>Reject Selected</span>
            </button>
            <button class="btn-bulk-approve" name="reviewAction" value="approved" type="submit" ${state.requestStatusFilter !== 'pending' ? 'disabled' : ''}>
              ${icon(Icons.Check, 'btn-icon-svg', 13)} <span>Approve Selected</span>
            </button>
          </div>
        </div>

        ${requests.length ? `
          <div class="admin-table-wrap">
            <table class="admin-data-table">
              <thead>
                <tr>
                  <th class="admin-check-cell"></th>
                  <th>Customer / Device</th>
                  <th>Promotion</th>
                  <th>Branch Location</th>
                  <th>Submitted At</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${requests.map(renderAdminRequestRow).join('')}
              </tbody>
            </table>
          </div>
        ` : renderEmptyState('No matching requests found.', 'Adjust your filter selection or wait for incoming claims.')}
      </form>

      ${selected ? renderRequestDetail(selected) : `
        <div class="select-hint-box">
          ${icon(Icons.Info, 'hint-icon', 16)}
          <span>Select any customer row above to inspect submission details, verify School ID image, or copy Device ID.</span>
        </div>
      `}
    </section>
  `;
}

function renderAdminRequestRow(request: AdminRequest): string {
  const selectable = request.status === 'pending';
  return `
    <tr class="${state.selectedRequestId === request.id ? 'is-selected' : ''}">
      <td class="admin-check-cell">
        ${selectable ? `<input name="request-select" value="${escapeHtml(request.id)}" type="checkbox" aria-label="Select request for ${escapeHtml(request.name)}"/>` : ''}
      </td>
      <td>
        <button class="admin-user-btn" type="button" data-action="select-request" data-request-id="${escapeHtml(request.id)}">
          <strong>${escapeHtml(request.name)}</strong>
          <span>${icon(Icons.Smartphone, 'cell-device-icon', 11)} ${escapeHtml(request.deviceId)}</span>
        </button>
      </td>
      <td><strong>${escapeHtml(request.promotionName)}</strong></td>
      <td>${escapeHtml(request.branchName)}</td>
      <td><time>${formatDate(request.createdAt)}</time></td>
      <td><span class="${statusClass(request.status)}">${statusLabel(request.status)}</span></td>
      <td>
        <div class="admin-row-actions">
          <button class="btn-row-action btn-row-copy" type="button" data-action="copy-id" data-copy-value="${escapeHtml(request.deviceId)}" title="Copy Device ID">
            ${icon(Icons.Copy, 'icon-xs', 12)}
          </button>
          ${selectable ? `
            <button class="btn-row-action btn-row-approve" type="button" data-action="approve-request" data-request-id="${escapeHtml(request.id)}">
              ${icon(Icons.Check, 'icon-xs', 12)} <span>Approve</span>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `;
}

function renderRequestDetail(request: AdminRequest): string {
  return `
    <section class="admin-panel admin-detail-panel" aria-labelledby="request-detail-heading">
      <div class="admin-panel-head">
        <div class="admin-panel-title-group">
          <p class="section-code">REQUEST DETAIL / REF #${escapeHtml(request.id.slice(0, 8).toUpperCase())}</p>
          <h3 id="request-detail-heading">${escapeHtml(request.name)}</h3>
        </div>
        <span class="${statusClass(request.status)}">${statusLabel(request.status)}</span>
      </div>

      <div class="admin-detail-grid">
        <div class="detail-item-card">
          <span>Customer Device ID</span>
          <div class="detail-device-row">
            <strong>${escapeHtml(request.deviceId)}</strong>
            <button class="btn-copy-chip" type="button" data-action="copy-id" data-copy-value="${escapeHtml(request.deviceId)}">
              ${icon(Icons.Copy, 'copy-icon', 12)} <span>Copy ID</span>
            </button>
          </div>
        </div>
        <div class="detail-item-card">
          <span>Target Promotion</span>
          <strong>${escapeHtml(request.promotionName)}</strong>
        </div>
        <div class="detail-item-card">
          <span>Branch Location</span>
          <strong>${escapeHtml(request.branchName)}</strong>
        </div>
        <div class="detail-item-card">
          <span>Submission Time</span>
          <strong>${formatDate(request.createdAt)}</strong>
        </div>
        <div class="detail-item-card">
          <span>Browser Notifications</span>
          <strong>${request.notificationEnabled ? 'Enabled (Subscribed)' : 'Disabled'}</strong>
        </div>
      </div>

      ${request.hasStudentDocument && request.studentDocumentId ? `
        <div class="detail-doc-callout">
          <div class="detail-doc-info">
            <span class="detail-doc-icon">${icon(Icons.GraduationCap, 'doc-cap-icon', 18)}</span>
            <div class="detail-doc-text">
              <strong>School ID Document Attached</strong>
              <span>Verified student verification upload for this claim.</span>
            </div>
          </div>
          <button class="btn-view-doc" type="button" data-action="view-document" data-document-id="${escapeHtml(request.studentDocumentId)}">
            ${icon(Icons.ExternalLink, 'doc-link-icon', 14)} <span>View School ID</span>
          </button>
        </div>
      ` : `
        <div class="detail-remarks-box" style="margin-bottom: 20px;">
          <span>Student Document Status</span>
          <p style="color: var(--ink-soft); font-size: 0.88rem;">No School ID document attached for this request.</p>
        </div>
      `}

      <div class="detail-actions-bar">
        <button class="btn-secondary-modern" type="button" data-action="copy-id" data-copy-value="${escapeHtml(request.deviceId)}">
          ${icon(Icons.Copy, 'btn-icon', 14)} <span>Copy Device ID</span>
        </button>
        ${request.status === 'pending' ? `
          <button class="btn-bulk-reject" type="button" data-action="reject-request" data-request-id="${escapeHtml(request.id)}">
            ${icon(Icons.X, 'btn-icon', 14)} <span>Reject Request</span>
          </button>
          <button class="btn-bulk-approve" type="button" data-action="approve-request" data-request-id="${escapeHtml(request.id)}">
            ${icon(Icons.Check, 'btn-icon', 14)} <span>Approve Claim</span>
          </button>
        ` : ''}
      </div>
    </section>
  `;
}

function renderAdminIssues(data: AdminData): string {
  const issues = data.issues.filter((issue) =>
    (state.issueStatusFilter === 'all' || issue.status === state.issueStatusFilter) &&
    (state.issueBranchFilter === 'all' || issue.branchId === state.issueBranchFilter)
  );
  const selected = state.selectedIssueId ? data.issues.find((issue) => issue.id === state.selectedIssueId) : null;
  return `
    <section class="admin-content">
      <div class="admin-filter-bar">
        <div class="admin-filter-group">
          <span class="admin-filter-label">${icon(Icons.Activity, 'filter-icon', 12)} Status Filter</span>
          <select data-filter="issue-status" class="admin-select admin-filter-select">
            <option value="pending" ${state.issueStatusFilter === 'pending' ? 'selected' : ''}>Pending Review</option>
            <option value="approved" ${state.issueStatusFilter === 'approved' ? 'selected' : ''}>Approved / Resolved</option>
            <option value="rejected" ${state.issueStatusFilter === 'rejected' ? 'selected' : ''}>Rejected</option>
            <option value="all" ${state.issueStatusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
          </select>
        </div>

        <div class="admin-filter-group">
          <span class="admin-filter-label">${icon(Icons.MapPin, 'filter-icon', 12)} Branch Location</span>
          <select data-filter="issue-branch" class="admin-select admin-filter-select">
            <option value="all">All Branches</option>
            ${data.branches.map((branch) => `<option value="${escapeHtml(branch.id)}" ${state.issueBranchFilter === branch.id ? 'selected' : ''}>${escapeHtml(branch.name)}</option>`).join('')}
          </select>
        </div>
      </div>

      <section class="admin-panel admin-table-panel">
        <div class="admin-table-toolbar">
          <div class="admin-panel-title-group">
            <p class="section-code">ISSUE QUEUE</p>
            <h3>${issues.length} User Report${issues.length === 1 ? '' : 's'}</h3>
          </div>
        </div>

        ${issues.length ? `
          <div class="admin-table-wrap">
            <table class="admin-data-table">
              <thead>
                <tr>
                  <th>Customer / Device</th>
                  <th>Issue Category</th>
                  <th>Report Details</th>
                  <th>Branch Location</th>
                  <th>Submitted At</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${issues.map(renderAdminIssueRow).join('')}
              </tbody>
            </table>
          </div>
        ` : renderEmptyState('No matching issue reports found.', 'Adjust your filter selection or wait for incoming reports.')}
      </section>

      ${selected ? renderIssueDetail(selected) : `
        <div class="select-hint-box">
          ${icon(Icons.Info, 'hint-icon', 16)}
          <span>Select any issue row above to view full customer statement and resolve or reject the ticket.</span>
        </div>
      `}
    </section>
  `;
}

function renderIssueDetail(issue: AdminIssue): string {
  const detail = issue.issueType === 'ghost_credit'
    ? `
      <div class="detail-item-card"><span>Unit Type</span><strong>${escapeHtml(adminUnitLabel(issue.unit))}</strong></div>
      <div class="detail-item-card"><span>Amount Inserted</span><strong>${issue.amountInserted ?? '—'}</strong></div>
      <div class="detail-item-card"><span>Amount Credited</span><strong>${issue.amountCredited ?? '—'}</strong></div>
    `
    : `<div class="detail-item-card"><span>Points Lost</span><strong>${issue.pointsLost ?? '—'} Points</strong></div>`;

  return `
    <section class="admin-panel admin-detail-panel" aria-labelledby="issue-detail-heading">
      <div class="admin-panel-head">
        <div class="admin-panel-title-group">
          <p class="section-code">ISSUE DETAIL / REF #${escapeHtml(issue.id.slice(0, 8).toUpperCase())}</p>
          <h3 id="issue-detail-heading">${issue.issueType === 'ghost_credit' ? 'Ghost Credit Report' : 'Lost Points Report'}</h3>
        </div>
        <span class="${statusClass(issue.status)}">${statusLabel(issue.status)}</span>
      </div>

      <div class="admin-detail-grid">
        <div class="detail-item-card">
          <span>Customer Device ID</span>
          <div class="detail-device-row">
            <strong>${escapeHtml(issue.deviceId)}</strong>
            <button class="btn-copy-chip" type="button" data-action="copy-id" data-copy-value="${escapeHtml(issue.deviceId)}">
              ${icon(Icons.Copy, 'copy-icon', 12)} <span>Copy ID</span>
            </button>
          </div>
        </div>
        <div class="detail-item-card">
          <span>Customer Name</span>
          <strong>${escapeHtml(issue.name)}</strong>
        </div>
        <div class="detail-item-card">
          <span>Branch Location</span>
          <strong>${escapeHtml(issue.branchName)}</strong>
        </div>
        <div class="detail-item-card">
          <span>Reported Timestamp</span>
          <strong>${formatDate(issue.createdAt)}</strong>
        </div>
        ${detail}
      </div>

      <div class="detail-remarks-box">
        <span>Customer Description & Remarks</span>
        <p>${escapeHtml(issue.description || 'No additional statement provided by the customer.')}</p>
      </div>

      <div class="detail-actions-bar">
        <button class="btn-secondary-modern" type="button" data-action="copy-id" data-copy-value="${escapeHtml(issue.deviceId)}">
          ${icon(Icons.Copy, 'btn-icon', 14)} <span>Copy Device ID</span>
        </button>
        ${issue.status === 'pending' ? `
          <button class="btn-bulk-reject" type="button" data-action="reject-issue" data-issue-id="${escapeHtml(issue.id)}">
            ${icon(Icons.X, 'btn-icon', 14)} <span>Reject Issue</span>
          </button>
          <button class="btn-bulk-approve" type="button" data-action="approve-issue" data-issue-id="${escapeHtml(issue.id)}">
            ${icon(Icons.Check, 'btn-icon', 14)} <span>Resolve & Approve</span>
          </button>
        ` : ''}
      </div>
    </section>
  `;
}

function renderAdminIssueRow(issue: AdminIssue): string {
  const detail = issue.issueType === 'ghost_credit'
    ? `${adminUnitLabel(issue.unit)}: Inserted ${issue.amountInserted ?? '—'} → Credited ${issue.amountCredited ?? '—'}`
    : `${issue.pointsLost ?? '—'} points lost`;
  const action = issue.status === 'pending'
    ? `
      <div class="admin-row-actions">
        <button class="btn-row-action btn-row-copy" type="button" data-action="copy-id" data-copy-value="${escapeHtml(issue.deviceId)}" title="Copy Device ID">
          ${icon(Icons.Copy, 'icon-xs', 12)}
        </button>
        <button class="btn-row-action btn-row-reject" type="button" data-action="reject-issue" data-issue-id="${escapeHtml(issue.id)}">
          ${icon(Icons.X, 'icon-xs', 12)} <span>Reject</span>
        </button>
        <button class="btn-row-action btn-row-approve" type="button" data-action="approve-issue" data-issue-id="${escapeHtml(issue.id)}">
          ${icon(Icons.Check, 'icon-xs', 12)} <span>Resolve</span>
        </button>
      </div>
    `
    : `
      <button class="btn-row-action btn-row-copy" type="button" data-action="copy-id" data-copy-value="${escapeHtml(issue.deviceId)}">
        ${icon(Icons.Copy, 'icon-xs', 12)} <span>Copy ID</span>
      </button>
    `;

  return `
    <tr class="${state.selectedIssueId === issue.id ? 'is-selected' : ''}">
      <td>
        <button class="admin-user-btn" type="button" data-action="select-issue" data-issue-id="${escapeHtml(issue.id)}">
          <strong>${escapeHtml(issue.name)}</strong>
          <span>${icon(Icons.Smartphone, 'cell-device-icon', 11)} ${escapeHtml(issue.deviceId)}</span>
        </button>
      </td>
      <td><strong>${issue.issueType === 'ghost_credit' ? 'Ghost Credit' : 'Lost Points'}</strong></td>
      <td>
        <div>${escapeHtml(detail)}</div>
        ${issue.description ? `<small style="color: var(--ink-soft); font-size: 0.76rem;">${escapeHtml(issue.description)}</small>` : ''}
      </td>
      <td>${escapeHtml(issue.branchName)}</td>
      <td><time>${formatDate(issue.createdAt)}</time></td>
      <td><span class="${statusClass(issue.status)}">${statusLabel(issue.status)}</span></td>
      <td>${action}</td>
    </tr>
  `;
}

function renderAdminBranches(data: AdminData): string {
  const editing = state.editingBranchId ? data.branches.find((branch) => branch.id === state.editingBranchId) : null;
  return `
    <section class="admin-content">
      <div class="admin-two-column">
        <form class="admin-panel" id="admin-branch-form">
          <div class="admin-panel-head">
            <div class="admin-panel-title-group">
              <p class="section-code">${editing ? 'EDIT BRANCH' : 'NEW LOCATION'}</p>
              <h3>${editing ? `Edit: ${escapeHtml(editing.name)}` : 'Add New Branch'}</h3>
            </div>
            ${editing ? `<button class="close-btn-modern" type="button" data-action="cancel-branch-edit" aria-label="Cancel edit">${icon(Icons.X, 'close-svg', 16)}</button>` : '<span class="panel-pill">LOCATIONS</span>'}
          </div>

          <div class="admin-form-stage">
            <label class="admin-field admin-field-wide">
              <span class="admin-label">Branch Location Name <b>*</b></span>
              <input name="name" maxlength="80" value="${escapeHtml(editing?.name || '')}" placeholder="e.g. Lisa’s Canteen [Candon] Branch" required class="admin-input" />
            </label>

            <div class="admin-toggles-container">
              <label class="admin-toggle-row">
                <div class="admin-toggle-info">
                  <strong>Active & Visible in Onboarding</strong>
                  <span>Allow users to select this branch during device registration</span>
                </div>
                <div class="admin-switch">
                  <input name="active" type="checkbox" ${editing?.active !== false ? 'checked' : ''} />
                  <span class="admin-switch-slider"></span>
                </div>
              </label>
            </div>

            <div class="admin-form-actions" style="display: flex; gap: 12px; margin-top: 8px;">
              ${editing ? `<button class="btn-secondary-modern" type="button" data-action="cancel-branch-edit">Cancel</button>` : ''}
              <button class="primary-action action-wide" type="submit">
                <span>${editing ? 'Save Changes' : 'Create Branch'}</span>
                <span class="action-arrow" aria-hidden="true">${icon(Icons.ArrowRight, 'btn-icon-svg', 16)}</span>
              </button>
            </div>
          </div>
        </form>

        <section class="admin-panel">
          <div class="admin-panel-head">
            <div class="admin-panel-title-group">
              <p class="section-code">BRANCH DIRECTORY</p>
              <h3>Configured Locations</h3>
            </div>
            <span class="panel-index">${data.branches.length} total</span>
          </div>

          ${data.branches.length ? `
            <div class="admin-branch-list">
              ${data.branches.map((branch) => `
                <div class="admin-branch-card">
                  <div class="admin-branch-info">
                    <strong>${escapeHtml(branch.name)}</strong>
                    <span>${branch.active ? 'Active & visible in customer setup' : 'Hidden from customer registration'}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="badge-status ${branch.active ? 'tag-active' : 'status-rejected'}">${branch.active ? 'Active' : 'Disabled'}</span>
                    <button class="btn-edit-promo" type="button" data-action="edit-branch" data-branch-id="${escapeHtml(branch.id)}">
                      ${icon(Icons.Pencil, 'btn-icon-svg', 13)} <span>Edit</span>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : renderEmptyState('No branches configured.', 'Create a branch location using the form on the left.')}
        </section>
      </div>
    </section>
  `;
}
function renderPrivacy(): string {
  return `
    <main class="onboarding-page privacy-page">
      <div class="onboarding-frame">
        <header class="onboarding-header">${renderBrand(true)}<a class="back-link" href="#/">Balik sa setup</a></header>
        <section class="privacy-panel">
          <p class="section-code">PRIVACY</p>
          <h1>Privacy</h1>
          <p class="intro-copy">Ito lang ang tine-save para ma-review ang requests at reports mo.</p>
          <div class="privacy-rules"><div><strong>Profile</strong><p>Device ID, pangalan, at branch ang naka-attach sa requests mo. Isang profile lang ang naka-link sa bawat Device ID.</p></div><div><strong>School ID</strong><p>Private ito. Admin lang ang makakakita para sa Student promo.</p></div><div><strong>Alerts</strong><p>Optional ang browser alerts para sa promo at review updates.</p></div><div><strong>Browser</strong><p>Walang MAC o hardware fingerprint na kinokolekta. Ang saved profile session ay para sa browser continuity; hindi ito hardware proof.</p></div></div>
          <a class="primary-action" href="#/">Balik sa setup <span class="action-arrow" aria-hidden="true">↗</span></a>
        </section>
      </div>
    </main>
  `;
}

function runMotion(): void {
  try {
    const entranceCards = Array.from(appRoot.querySelectorAll('.onboarding-hero, .onboarding-card, .profile-editor-card, .offer-card, .status-item-card, .issue-choice-card, .empty-state-card, .summary-strip > div, .admin-panel, .privacy-panel'));
    if (entranceCards.length) {
      animate(entranceCards, { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] }, { duration: 0.35, delay: stagger(0.04), ease: [0.16, 1, 0.3, 1] });
    }
    const pills = Array.from(appRoot.querySelectorAll('.badge-hero, .hero-badge, .room-branch-pill, .panel-pill'));
    if (pills.length) {
      animate(pills, { scale: [0.94, 1], opacity: [0, 1] }, { duration: 0.25, ease: 'easeOut' });
    }
  } catch {
    // Graceful fallback if motion cannot run
  }
}

function render(): void {
  document.title = state.view === 'admin' || state.view === 'admin-login' ? `Admin · ${appConfig.appName}` : appConfig.appName;
  if (state.view === 'onboarding') appRoot.innerHTML = renderOnboarding();
  else if (state.view === 'privacy') appRoot.innerHTML = renderPrivacy();
  else if (state.view === 'home') appRoot.innerHTML = renderHome();
  else if (state.view === 'admin-login') appRoot.innerHTML = renderAdminLogin();
  else appRoot.innerHTML = renderAdminShell();
  runMotion();
}

function formString(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
}

async function bootPublic(): Promise<void> {
  const token = getProfileToken();
  if (token && hasBackendConfig) {
    state.view = 'home';
    state.loading = true;
    render();
    try {
      const data = await loadPublicData(token);
      state.publicData = data;
      state.profile = data.profile;
      if (state.targetPromoId) {
        state.activePromoRequest = state.targetPromoId;
        state.homeTab = 'promos';
      }
      state.loading = false;
      render();
      return;
    } catch (error) {
      state.loading = false;
      if (error instanceof ApiError && error.status === 401) {
        clearProfileToken();
        state.error = 'Hindi na valid ang saved profile. Ilagay ulit ang details mo.';
      } else {
        state.error = error instanceof Error ? error.message : 'Hindi ma-load ang room.';
      }
    }
  }
  state.view = 'onboarding';
  if (hasBackendConfig) {
    try {
      state.branches = (await loadPublicBranches()).branches;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Hindi ma-load ang branches.';
    }
  }
  state.loading = false;
  render();
}

async function bootAdmin(): Promise<void> {
  state.view = 'admin-login';
  if (!supabase || !hasBackendConfig) {
    render();
    return;
  }
  state.loading = true;
  render();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    state.loading = false;
    render();
    return;
  }
  state.adminSession = data.session;
  state.adminToken = data.session.access_token;
  await loadAdminConsole();
}

async function loadAdminConsole(): Promise<void> {
  if (!state.adminToken) {
    state.view = 'admin-login';
    state.loading = false;
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    state.adminData = await loadAdminData(state.adminToken);
    state.view = 'admin';
    state.loading = false;
    state.error = '';
    render();
  } catch (error) {
    state.loading = false;
    state.adminData = null;
    state.view = 'admin-login';
    state.error = error instanceof Error ? error.message : 'Hindi ma-load ang admin data.';
    render();
  }
}

async function submitOnboarding(form: HTMLFormElement): Promise<void> {
  const documentInput = form.querySelector<HTMLInputElement>('input[name="studentDocument"]');
  const documentFile = documentInput?.files?.[0] || null;
  const deviceId = normalizeDeviceId(formString(form, 'deviceId').trim());
  const input = {
    deviceId,
    name: formString(form, 'name').trim(),
    branchId: formString(form, 'branchId'),
    privacyConsent: form.querySelector<HTMLInputElement>('input[name="privacyConsent"]')?.checked === true,
  };
  const errors = validateProfile(input);
  if (documentFile) {
    const documentError = validateDocument(documentFile);
    if (documentError) errors.studentDocument = documentError;
  }
  const validationError = firstError(errors);
  if (validationError) {
    setError(validationError);
    return;
  }
  const notificationPermissionPromise = form.querySelector<HTMLInputElement>('input[name="notifyOptIn"]')?.checked === true && getNotificationAvailability() === 'available'
    ? requestNotificationPermission()
    : null;
  state.loading = true;
  render();
  try {
    const created = await createProfile(input);
    saveProfileToken(created.profileToken);
    let documentWarning = '';
    if (documentFile) {
      try {
        await uploadStudentDocument(documentFile, created.profileToken);
      } catch (error) {
        documentWarning = error instanceof Error ? ` Na-save ang profile pero hindi na-upload ang School ID: ${error.message}` : ' Na-save ang profile pero hindi na-upload ang School ID.';
      }
    }
    let notificationWarning = '';
    if (notificationPermissionPromise) {
      try {
        const permission = await notificationPermissionPromise;
        const result = await enableNotifications(created.profileToken, permission);
        if (!result.enabled) notificationWarning = ` ${result.message}`;
      } catch (error) {
        notificationWarning = ` Hindi na-enable ang alerts: ${error instanceof Error ? error.message : 'may problema sa setup.'}`;
      }
    }
    const data = await loadPublicData(created.profileToken);
    state.publicData = data;
    state.profile = data.profile;
    state.view = 'home';
    state.homeTab = 'promos';
    if (state.targetPromoId) {
      state.activePromoRequest = state.targetPromoId;
    }
    state.loading = false;
    state.error = '';
    state.toast = `Ready na ang profile.${documentWarning}${notificationWarning}`;
    render();
  } catch (error) {
    state.loading = false;
    setError(error instanceof Error ? error.message : 'Hindi ma-save ang profile.');
  }
}

async function submitProfileEdit(form: HTMLFormElement): Promise<void> {
  const token = getProfileToken();
  if (!token || !state.profile) return;
  const input = {
    deviceId: normalizeDeviceId(formString(form, 'deviceId').trim()),
    name: formString(form, 'name').trim(),
  };
  const validationError = firstError(validateProfileEdit(input));
  if (validationError) {
    setError(validationError);
    return;
  }

  state.loading = true;
  render();
  try {
    const updated = await updateProfile(input, token);
    state.profile = updated.profile;
    state.publicData = await loadPublicData(token);
    state.profile = state.publicData.profile;
    state.loading = false;
    state.editingProfile = false;
    state.error = '';
    setToast('Na-update ang profile. Pareho pa rin ang profile at history mo.');
  } catch (error) {
    state.loading = false;
    if (error instanceof ApiError && error.status === 401) {
      clearProfileToken();
      state.profile = null;
      state.publicData = null;
      state.editingProfile = false;
      await bootPublic();
      return;
    }
    setError(error instanceof Error ? error.message : 'Hindi ma-update ang profile.');
  }
}

async function refreshPublic(): Promise<void> {
  const token = getProfileToken();
  if (!token) {
    await bootPublic();
    return;
  }
  state.loading = true;
  render();
  try {
    const data = await loadPublicData(token);
    state.publicData = data;
    state.profile = data.profile;
    state.loading = false;
    state.error = '';
    render();
  } catch (error) {
    state.loading = false;
    setError(error instanceof Error ? error.message : 'Hindi ma-refresh ang room.');
  }
}

async function enableNotificationsForProfile(): Promise<void> {
  const token = getProfileToken();
  if (!token) return;
  try {
    const result = await enableNotifications(token);
    if (result.enabled) {
      await refreshPublic();
      setToast(result.message);
    } else {
      setError(result.message);
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Hindi ma-enable ang alerts.');
  }
}

async function requestPromotion(promotionId: string): Promise<void> {
  const promo = state.publicData?.promotions.find((item) => item.id === promotionId);
  const token = getProfileToken();
  if (!promo || !token) return;
  if (promo.requiresStudentDocument && !state.profile?.hasStudentDocument) {
    state.activePromoRequest = promotionId;
    state.error = '';
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    const result = await submitPromoRequest(promotionId, token);
    state.activePromoRequest = null;
    if (result.voucherCode) {
      state.activeClaimedVoucher = { promoName: promo.name, code: result.voucherCode };
    }
    await refreshPublic();
    setToast(result.voucherCode ? `Claimed voucher code for ${promo.name}!` : `Na-send ang request para sa ${promo.name}.`);
  } catch (error) {
    state.loading = false;
    setError(error instanceof Error ? error.message : 'Hindi ma-send ang promo request.');
  }
}

async function submitPromoForm(form: HTMLFormElement): Promise<void> {
  const promotionId = form.dataset.promotionId;
  const token = getProfileToken();
  const promo = state.publicData?.promotions.find((item) => item.id === promotionId);
  if (!promotionId || !token || !promo) return;
  const file = form.querySelector<HTMLInputElement>('input[name="studentDocument"]')?.files?.[0] || null;
  if (promo.requiresStudentDocument && !state.profile?.hasStudentDocument) {
    const fileError = validateDocument(file);
    if (fileError) {
      setError(fileError);
      return;
    }
  }
  state.loading = true;
  render();
  try {
    if (file) await uploadStudentDocument(file, token);
    const result = await submitPromoRequest(promotionId, token);
    state.activePromoRequest = null;
    if (result.voucherCode) {
      state.activeClaimedVoucher = { promoName: promo.name, code: result.voucherCode };
    }
    await refreshPublic();
    setToast(result.voucherCode ? `Claimed voucher code for ${promo.name}!` : `Na-send ang request para sa ${promo.name}.`);
  } catch (error) {
    state.loading = false;
    setError(error instanceof Error ? error.message : 'Hindi ma-send ang promo request.');
  }
}

async function submitIssueForm(form: HTMLFormElement): Promise<void> {
  const issueType = form.dataset.issueType as IssueType | undefined;
  const token = getProfileToken();
  if (!issueType || !token) return;
  const description = formString(form, 'description').trim();
  if (description.length > 500) {
    setError('Max 500 characters lang ang detalye.');
    return;
  }
  let payload: Parameters<typeof submitIssue>[0];
  if (issueType === 'ghost_credit') {
    const unit = formString(form, 'unit') as CreditUnit;
    const amountInserted = formString(form, 'amountInserted');
    const amountCredited = formString(form, 'amountCredited');
    const errors = validateGhostCredit({ unit, amountInserted, amountCredited });
    const validationError = firstError(errors);
    if (validationError) {
      setError(validationError);
      return;
    }
    payload = { issueType, unit, amountInserted: parsePositiveNumber(amountInserted) || 0, amountCredited: parseNonNegativeNumber(amountCredited) || 0, description };
  } else {
    const pointsLost = formString(form, 'pointsLost');
    const validationError = firstError(validateLostPoints(pointsLost));
    if (validationError) {
      setError(validationError);
      return;
    }
    payload = { issueType, pointsLost: parsePositiveNumber(pointsLost) || 0, description };
  }
  state.loading = true;
  render();
  try {
    await submitIssue(payload, token);
    state.issueComposer = null;
    await refreshPublic();
    setToast('Na-send ang report para sa review.');
  } catch (error) {
    state.loading = false;
    setError(error instanceof Error ? error.message : 'Hindi ma-send ang issue report.');
  }
}

async function handleAdminLogin(form: HTMLFormElement): Promise<void> {
  if (!supabase) {
    setError('Admin authentication is not configured yet.');
    return;
  }
  state.loading = true;
  render();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: formString(form, 'email').trim(),
    password: formString(form, 'password'),
  });
  if (error || !data.session) {
    state.loading = false;
    setError(error?.message || 'Login failed: invalid email or password.');
    return;
  }
  state.adminSession = data.session;
  state.adminToken = data.session.access_token;
  await loadAdminConsole();
}

async function handleBranchSave(form: HTMLFormElement): Promise<void> {
  if (!state.adminToken) return;
  const name = formString(form, 'name').trim();
  if (!name) {
    setError('Please enter a branch name.');
    return;
  }
  try {
    await saveBranch(state.adminToken, {
      id: state.editingBranchId || undefined,
      name,
      active: form.querySelector<HTMLInputElement>('input[name="active"]')?.checked === true,
    });
    state.editingBranchId = null;
    await loadAdminConsole();
    setToast('Branch saved successfully.');
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Failed to save branch.');
  }
}

function resetPromotionEditor(): void {
  state.editingPromotionId = null;
  state.editingFulfillmentType = 'manual_topup';
  state.importerActiveTab = 'paste';
  state.importerTextDraft = '';
  state.importerSpreadsheet = null;
  state.importerMapping = { codeColIndex: 0, timeColIndex: -1, labelColIndex: -1, branchColIndex: -1 };
  state.importerFallbackDuration = '';
  state.importerSelectedBranchId = 'all';
}

async function handlePromotionSave(form: HTMLFormElement): Promise<void> {
  if (!state.adminToken || !state.adminData) return;
  const fulfillmentType = state.editingFulfillmentType;
  let slots: Array<{ branchId: string; capacity: number }> = [];
  let vouchers: Array<{ code: string; durationLabel?: string; branchId?: string }> = [];

  if (fulfillmentType === 'voucher') {
    const branches = state.adminData.branches;
    const selectedBranchId = state.importerSelectedBranchId !== 'all' ? state.importerSelectedBranchId : undefined;
    if (state.importerActiveTab === 'paste') {
      const parsed = parseRawVoucherText(state.importerTextDraft, state.importerFallbackDuration, selectedBranchId, branches);
      vouchers = parsed.vouchers;
    } else if (state.importerActiveTab === 'file' && state.importerSpreadsheet) {
      const parsed = applyColumnMapping(state.importerSpreadsheet, state.importerMapping, branches, selectedBranchId, state.importerFallbackDuration);
      vouchers = parsed.vouchers;
    }
    // Voucher inventory, not manual slot quotas, controls availability.
    slots = [];
  } else {
    slots = state.adminData.branches.map((branch) => ({
      branchId: branch.id,
      capacity: Number(formString(form, `slot-${branch.id}`)),
    }));
    if (!slots.length) {
      setError('Please add at least one branch first.');
      return;
    }
    if (slots.some((slot) => !Number.isInteger(slot.capacity) || slot.capacity < 0)) {
      setError('Capacity values must be integers of 0 or greater.');
      return;
    }
  }

  try {
    await savePromotion(state.adminToken, {
      id: state.editingPromotionId || undefined,
      name: formString(form, 'name').trim(),
      description: formString(form, 'description').trim(),
      audience: formString(form, 'audience'),
      fulfillmentType,
      active: form.querySelector<HTMLInputElement>('input[name="active"]')?.checked === true,
      published: form.querySelector<HTMLInputElement>('input[name="published"]')?.checked === true,
      notifyOnPublish: form.querySelector<HTMLInputElement>('input[name="notifyOnPublish"]')?.checked === true,
      slots,
      vouchers: vouchers.length > 0 ? vouchers : undefined,
    });
    resetPromotionEditor();
    await loadAdminConsole();
    setToast(vouchers.length ? `Promotion saved with ${vouchers.length} vouchers imported.` : 'Promotion saved successfully.');
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Failed to save promotion.');
  }
}

async function handleBulkReview(form: HTMLFormElement, submitter: Element | null): Promise<void> {
  if (!state.adminToken) return;
  const ids = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="request-select"]:checked')).map((input) => input.value);
  const actionValue = submitter instanceof HTMLButtonElement ? submitter.value : 'approved';
  const status = actionValue === 'rejected' ? 'rejected' : 'approved';
  if (!ids.length) {
    setError('Please select at least one pending request.');
    return;
  }
  const actionLabel = status === 'approved' ? 'approve' : 'reject';
  if (!window.confirm(`${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} ${ids.length} selected request${ids.length === 1 ? '' : 's'}?`)) return;
  try {
    const result = await reviewPromoRequests(state.adminToken, ids, status);
    await loadAdminConsole();
    const skipped = result.skipped?.length || 0;
    setToast(`${result.approved?.length || 0} approved, ${result.rejected?.length || 0} rejected${skipped ? `, ${skipped} skipped` : ''}.`);
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Bulk review could not be completed.');
  }
}

async function reviewOneRequest(requestId: string, status: 'approved' | 'rejected'): Promise<void> {
  if (!state.adminToken) return;
  if (!window.confirm(`${status === 'approved' ? 'Approve' : 'Reject'} this promo claim request?`)) return;
  try {
    const result = await reviewPromoRequests(state.adminToken, [requestId], status);
    await loadAdminConsole();
    setToast(result.skipped?.length ? `Request skipped: ${result.skipped[0].reason}.` : `Request ${status} successfully.`);
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Request review could not be completed.');
  }
}

async function reviewOneIssue(issueId: string, status: 'approved' | 'rejected'): Promise<void> {
  if (!state.adminToken) return;
  if (!window.confirm(`${status === 'approved' ? 'Approve / Resolve' : 'Reject'} this issue report?`)) return;
  try {
    await reviewIssue(state.adminToken, issueId, status);
    await loadAdminConsole();
    setToast(`Issue report ${status === 'approved' ? 'resolved' : 'rejected'} successfully.`);
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Issue review could not be completed.');
  }
}

async function copyId(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    setToast('Device ID / Code copied to clipboard.');
  } catch {
    setToast(`Could not copy automatically. Select manually: ${value}`);
  }
}

async function handleClick(event: MouseEvent): Promise<void> {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
  if (!target) return;
  const action = target.dataset.action;
  state.error = '';
  if (action === 'start-setup') {
    state.onboardingStep = 'form';
    render();
  } else if (action === 'back-to-story') {
    state.onboardingStep = 'story';
    render();
  } else if (action === 'share-promo' && target.dataset.promotionId) {
    const promoId = target.dataset.promotionId;
    const promo = state.publicData?.promotions.find((item) => item.id === promoId);
    const shareUrl = `${window.location.origin}${window.location.pathname}#/promo/${promoId}`;
    if (navigator.share) {
      navigator.share({ title: promo?.name || 'DXTECH Promo', text: 'Tingnan ang exclusive promo sa DXTECH PisoWiFi Hub!', url: shareUrl }).catch(() => {});
    } else {
      void copyId(shareUrl);
      setToast(`Na-copy ang promo share link para sa ${promo?.name || 'promo'}!`);
    }
  } else if (action === 'home-tab') {
    state.homeTab = target.dataset.tab === 'issues' ? 'issues' : 'promos';
    state.issueComposer = null;
    state.activePromoRequest = null;
    render();
  } else if (action === 'request-promo' && target.dataset.promotionId) {
    await requestPromotion(target.dataset.promotionId);
  } else if (action === 'cancel-promo-request') {
    state.activePromoRequest = null;
    render();
  } else if (action === 'close-voucher-modal') {
    state.activeClaimedVoucher = null;
    render();
  } else if (action === 'importer-tab') {
    state.importerActiveTab = (target.dataset.tab as 'paste' | 'file') || 'paste';
    render();
  } else if (action === 'view-vouchers') {
    const promoId = target.dataset.promotionId;
    if (promoId && state.adminToken) {
      state.voucherModalPromotionId = promoId;
      state.voucherModalLoading = true;
      state.voucherSearchQuery = '';
      render();
      try {
        const res = await getPromotionVouchers(state.adminToken, promoId);
        state.voucherModalList = res.vouchers;
        state.voucherModalLoading = false;
        render();
      } catch (err) {
        state.voucherModalLoading = false;
        setError(err instanceof Error ? err.message : 'Could not load voucher inventory.');
      }
    }
  } else if (action === 'close-voucher-drawer') {
    state.voucherModalPromotionId = null;
    state.voucherModalList = null;
    render();
  } else if (action === 'choose-issue') {
    state.issueComposer = target.dataset.issueType as IssueType;
    render();
  } else if (action === 'cancel-issue') {
    state.issueComposer = null;
    render();
  } else if (action === 'enable-notifications') {
    await enableNotificationsForProfile();
  } else if (action === 'refresh-public') {
    await refreshPublic();
  } else if (action === 'edit-profile') {
    state.editingProfile = true;
    render();
  } else if (action === 'cancel-profile-edit') {
    state.editingProfile = false;
    render();
  } else if (action === 'admin-tab') {
    state.adminTab = (target.dataset.tab as AdminTab) || 'overview';
    state.error = '';
    render();
  } else if (action === 'new-promo') {
    resetPromotionEditor();
    state.adminTab = 'promos';
    state.error = '';
    render();
  } else if (action === 'admin-logout') {
    await supabase?.auth.signOut();
    state.adminSession = null;
    state.adminToken = null;
    state.adminData = null;
    window.location.hash = '#/admin';
    await bootAdmin();
  } else if (action === 'refresh-admin') {
    await loadAdminConsole();
  } else if (action === 'edit-promo') {
    const promotionId = target.dataset.promotionId || null;
    const editingPromo = state.adminData?.promotions.find((p) => p.id === promotionId);
    resetPromotionEditor();
    state.adminTab = 'promos';
    state.editingPromotionId = promotionId;
    state.editingFulfillmentType = editingPromo?.fulfillmentType || 'manual_topup';
    state.voucherModalPromotionId = null;
    render();
  } else if (action === 'cancel-promo-edit') {
    resetPromotionEditor();
    render();
  } else if (action === 'edit-branch') {
    state.adminTab = 'branches';
    state.editingBranchId = target.dataset.branchId || null;
    render();
  } else if (action === 'cancel-branch-edit') {
    state.editingBranchId = null;
    render();
  } else if (action === 'select-request') {
    state.selectedRequestId = target.dataset.requestId || null;
    render();
  } else if (action === 'select-issue') {
    state.selectedIssueId = target.dataset.issueId || null;
    render();
  } else if (action === 'approve-request' && target.dataset.requestId) {
    await reviewOneRequest(target.dataset.requestId, 'approved');
  } else if (action === 'reject-request' && target.dataset.requestId) {
    await reviewOneRequest(target.dataset.requestId, 'rejected');
  } else if (action === 'approve-issue' && target.dataset.issueId) {
    await reviewOneIssue(target.dataset.issueId, 'approved');
  } else if (action === 'reject-issue' && target.dataset.issueId) {
    await reviewOneIssue(target.dataset.issueId, 'rejected');
  } else if (action === 'copy-id' && target.dataset.copyValue) {
    await copyId(target.dataset.copyValue);
  } else if (action === 'view-document' && target.dataset.documentId && state.adminToken) {
    const documentWindow = window.open('about:blank', '_blank');
    if (!documentWindow) {
      setError('Please allow browser pop-ups to view the private School ID.');
      return;
    }
    documentWindow.opener = null;
    try {
      const result = await getStudentDocumentUrl(state.adminToken, target.dataset.documentId);
      documentWindow.location.href = result.url;
    } catch (error) {
      documentWindow.close();
      setError(error instanceof Error ? error.message : 'Could not open School ID document.');
    }
  }
}

function rerenderPreservingFocus(target: HTMLInputElement | HTMLTextAreaElement): void {
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  const name = target.name;
  const filter = target.dataset.filter || '';
  render();
  const next = Array.from(appRoot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).find(
    (element) => element.name === name && (element.dataset.filter || '') === filter
  );
  if (!next) return;
  next.focus();
  if (selectionStart !== null && selectionEnd !== null) next.setSelectionRange(selectionStart, selectionEnd);
}

function handleInput(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.matches('[data-device-id]')) {
    target.value = normalizeDeviceId(target.value);
  } else if (target instanceof HTMLTextAreaElement && target.name === 'voucherTextDraft') {
    state.importerTextDraft = target.value;
    rerenderPreservingFocus(target);
  } else if (target instanceof HTMLInputElement && target.name === 'importerFallbackDuration') {
    state.importerFallbackDuration = target.value;
    rerenderPreservingFocus(target);
  } else if (target instanceof HTMLInputElement && target.dataset.filter === 'voucher-search') {
    state.voucherSearchQuery = target.value;
    rerenderPreservingFocus(target);
  }
}

async function handleFilter(event: Event): Promise<void> {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.name === 'voucherFile' && target.files && target.files.length > 0) {
    const file = target.files[0];
    try {
      state.loading = true;
      render();
      state.importerSpreadsheet = await parseSpreadsheetFile(file);
      state.importerMapping = state.importerSpreadsheet.detectedMapping;
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      setError(err instanceof Error ? err.message : 'Could not parse spreadsheet file.');
    }
    return;
  }
  if (target instanceof HTMLSelectElement && target.dataset.importerConfig && state.importerSpreadsheet) {
    const configType = target.dataset.importerConfig;
    const val = Number(target.value);
    if (configType === 'header-row') {
      state.importerSpreadsheet.headerRowIndex = val;
      state.importerSpreadsheet.headers = extractHeadersFromMatrix(state.importerSpreadsheet.matrix, val);
      state.importerMapping = state.importerSpreadsheet.detectedMapping;
      if (state.importerSpreadsheet.dataStartRowIndex <= val) {
        state.importerSpreadsheet.dataStartRowIndex = val + 1;
      }
    } else if (configType === 'start-row') {
      state.importerSpreadsheet.dataStartRowIndex = val;
    }
    render();
    return;
  }
  if (target instanceof HTMLSelectElement && target.dataset.mapper) {
    const field = target.dataset.mapper;
    const val = Number(target.value);
    if (field === 'code') state.importerMapping.codeColIndex = val;
    else if (field === 'time') state.importerMapping.timeColIndex = val;
    else if (field === 'label') state.importerMapping.labelColIndex = val;
    else if (field === 'branch') state.importerMapping.branchColIndex = val;
    render();
    return;
  }
  if (target instanceof HTMLInputElement && target.name === 'fulfillmentType') {
    state.editingFulfillmentType = target.value as FulfillmentType;
    render();
    return;
  }
  if (target instanceof HTMLSelectElement && target.name === 'importerSelectedBranchId') {
    state.importerSelectedBranchId = target.value;
    render();
    return;
  }
  if (target instanceof HTMLInputElement && target.type === 'file' && target.files && target.files.length > 0) {
    const file = target.files[0];
    const dropzone = target.closest('.custom-file-dropzone');
    const label = dropzone?.querySelector<HTMLElement>('.file-chosen-name');
    if (label) {
      label.textContent = `Nai-upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) ✓`;
      label.classList.add('is-file-selected');
    }
    return;
  }
  if (!(target instanceof HTMLSelectElement) || !target.dataset.filter) return;
  const filter = target.dataset.filter;
  if (filter === 'request-status') state.requestStatusFilter = target.value as AppState['requestStatusFilter'];
  if (filter === 'request-branch') state.requestBranchFilter = target.value;
  if (filter === 'request-promo') state.requestPromotionFilter = target.value;
  if (filter === 'issue-status') state.issueStatusFilter = target.value as AppState['issueStatusFilter'];
  if (filter === 'issue-branch') state.issueBranchFilter = target.value;
  render();
}
function parseRoute(): { view: View; promoId: string | null } {
  const hash = window.location.hash || '#/';
  const urlParams = new URLSearchParams(window.location.search);
  const promoFromQuery = urlParams.get('promo');
  const emailFromQuery = urlParams.get('email');
  const passwordFromQuery = urlParams.get('password');
  if (emailFromQuery) state.adminPrefillEmail = emailFromQuery;
  if (passwordFromQuery) state.adminPrefillPassword = passwordFromQuery;

  if (hash.startsWith('#/admin')) {
    return { view: 'admin', promoId: null };
  }
  if (hash.startsWith('#/privacy')) {
    return { view: 'privacy', promoId: null };
  }
  const promoMatch = hash.match(/^#\/(?:promo|p)\/([a-zA-Z0-9_-]+)/);
  if (promoMatch) {
    return { view: 'onboarding', promoId: promoMatch[1] };
  }
  if (promoFromQuery) {
    return { view: 'onboarding', promoId: promoFromQuery };
  }
  return { view: 'onboarding', promoId: null };
}

async function bootRoute(): Promise<void> {
  const parsed = parseRoute();
  if (parsed.promoId) {
    state.targetPromoId = parsed.promoId;
  }
  if (parsed.view === 'admin') {
    await bootAdmin();
    return;
  }
  if (parsed.view === 'privacy') {
    state.view = 'privacy';
    state.error = '';
    render();
    return;
  }
  state.onboardingStep = 'story';
  await bootPublic();
}
window.addEventListener('hashchange', bootRoute);
appRoot.addEventListener('click', (event) => {
  void handleClick(event);
});
appRoot.addEventListener('input', handleInput);
appRoot.addEventListener('change', (event) => {
  void handleFilter(event);
});
appRoot.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === 'onboarding-form') void submitOnboarding(form);
  else if (form.id === 'profile-edit-form') void submitProfileEdit(form);
  else if (form.id === 'promo-request-form') void submitPromoForm(form);
  else if (form.id === 'issue-form') void submitIssueForm(form);
  else if (form.id === 'admin-login-form') void handleAdminLogin(form);
  else if (form.id === 'admin-branch-form') void handleBranchSave(form);
  else if (form.id === 'admin-promo-form') void handlePromotionSave(form);
  else if (form.id === 'bulk-review-form') void handleBulkReview(form, (event as SubmitEvent).submitter);
});

bootRoute();

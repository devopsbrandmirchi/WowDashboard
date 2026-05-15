import { useApp } from '../context/AppContext';

export function MaintenancePage() {
  const { branding } = useApp();
  const agencyName = branding?.agencyName || 'chipper';
  const agencyLogo = branding?.agencyLogo || 'DIGITAL';

  return (
    <div className="maintenance-landing" id="page-maintenance">
      <div className="maintenance-landing__noise" aria-hidden />
      <div className="maintenance-landing__glow maintenance-landing__glow--warm" aria-hidden />
      <div className="maintenance-landing__glow maintenance-landing__glow--cool" aria-hidden />

      <div className="maintenance-landing__inner">
        <div className="maintenance-landing__brand brand-logo-text">
          <span className="brand-chipper">{agencyName}</span>
          <span className="brand-digital">{agencyLogo}</span>
        </div>

        <h1 className="maintenance-landing__title">
          Sorry! We&apos;re under
          <br />
          scheduled maintenance!
        </h1>

        <p className="maintenance-landing__desc">
          Our dashboard is currently undergoing scheduled maintenance. We will be back soon!
          Thank you for your patience.
        </p>
      </div>
    </div>
  );
}

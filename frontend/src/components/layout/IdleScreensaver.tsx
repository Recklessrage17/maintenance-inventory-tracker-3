// Handles the clean idle/manual screensaver display.
export function IdleScreensaver() {
  return (
    <section className="dashboard-screensaver" aria-label="Idle dashboard screensaver">
      <div className="dashboard-screensaver-logo" aria-hidden="true">
        <span className="dashboard-screensaver-logo-main">JBT</span>
        <span className="dashboard-screensaver-logo-country">USA</span>
        <span className="dashboard-screensaver-logo-line" />
      </div>
    </section>
  );
}

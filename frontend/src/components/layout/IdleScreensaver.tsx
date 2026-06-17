// Handles the clean idle/manual screensaver display.
export function IdleScreensaver() {
  return (
    <section className="dashboard-screensaver" aria-label="Idle dashboard screensaver">
      <div className="dashboard-screensaver-logo" aria-hidden="true">
        <span className="dashboard-screensaver-logo-main">Maintenance Command Central</span>
        <span className="dashboard-screensaver-logo-subtext">MIT3 will merge into Maintenance Command Central</span>
        <span className="dashboard-screensaver-logo-line" />
      </div>
    </section>
  );
}

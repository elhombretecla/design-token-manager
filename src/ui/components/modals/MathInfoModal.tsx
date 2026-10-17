/**
 * ui/components/modals/MathInfoModal.tsx
 *
 * Reference for math expressions in token values.
 */

import { ModalFrame, openModal } from "../../overlays";

export function openMathInfoModal(): void {
  openModal(<MathInfoModal />, { wide: true });
}

function MathInfoModal() {
  return (
    <ModalFrame title="Math in token values">
      <div class="math-modal-grid">
        <div>
          <h3 class="math-section-heading">Basic operators</h3>

          <div class="math-op-block">
            <p class="math-op-name">Add <code>(+)</code></p>
            <p class="math-op-desc">Add two values or tokens.</p>
            <code class="math-example">spacing.sm + 4</code>
            <p class="math-example-note">→ Adds 4 to the spacing value.</p>
          </div>

          <div class="math-op-block">
            <p class="math-op-name">Subtract <code>(-)</code></p>
            <p class="math-op-desc">Subtract one value or token from another.</p>
            <code class="math-example">spacing.lg - spacing.sm</code>
            <p class="math-example-note">→ Calculates the difference.</p>
          </div>

          <div class="math-op-block">
            <p class="math-op-name">Multiply <code>(*)</code></p>
            <p class="math-op-desc">Multiply values or tokens.</p>
            <code class="math-example">spacing.md * 2</code>
            <p class="math-example-note">→ Doubles the value.</p>
          </div>

          <div class="math-op-block">
            <p class="math-op-name">Divide <code>(/)</code></p>
            <p class="math-op-desc">Divide values or tokens.</p>
            <code class="math-example">value / rem-base</code>
            <p class="math-example-note">→ Scales a unitless number for rem conversion.</p>
          </div>

          <h3 class="math-section-heading" style={{ marginTop: "16px" }}>Parentheses for grouping</h3>
          <p class="math-body-text">You can use parentheses to control order of operations.</p>
          <code class="math-example">(8 * 8)</code>
          <p class="math-example-note">→ 64.</p>

          <hr class="math-divider" />

          <h3 class="math-section-heading">Functions</h3>
          <div class="math-op-block">
            <p class="math-op-name"><code>roundTo(value, decimals)</code></p>
            <p class="math-op-desc">Rounds a computed result to a specific precision.</p>
            <p class="math-body-text">What it does: Removes decimals or limits decimals to the given number.</p>
            <code class="math-example">roundTo({"{sizing.sm}"} * 1.33, 0)</code>
            <p class="math-example-note">→ rounds to a whole number.</p>
          </div>
        </div>

        <div>
          <h3 class="math-section-heading">Notes &amp; constraints</h3>

          <div class="math-note-block">
            <p class="math-note-title">Incompatible cases</p>
            <p class="math-note-text">
              You cannot use math with tokens that contain multiple values (like composite spacing tokens with
              two numbers).
            </p>
          </div>

          <div class="math-note-block">
            <p class="math-note-text">
              You cannot mix units in the same equation (e.g., rem + px). The parser only works if units are the
              same or if values are unitless.
            </p>
          </div>

          <h3 class="math-section-heading" style={{ marginTop: "16px" }}>Syntax rules</h3>
          <p class="math-body-text">
            Always include spaces around math operators (e.g.,&nbsp;
            <code class="math-example math-example--inline">8 * 8</code>, not&nbsp;
            <code class="math-example math-example--inline">8*8</code>). This is required for correct
            transformation.
          </p>

          <hr class="math-divider" />

          <h3 class="math-section-heading">Common use cases</h3>
          <p class="math-body-text">Here are typical patterns you'll see in real token systems:</p>

          <div class="math-use-case-block">
            <p class="math-use-case-label">Scaling values:</p>
            <code class="math-example">base-size * 1.2</code>
            <p class="math-use-case-note">→ scale up a token value.</p>
          </div>

          <div class="math-use-case-block">
            <p class="math-use-case-label">Calculating ratios or multipliers:</p>
            <p class="math-use-case-note">
              Use math to generate percentages or dynamic spacings based on other tokens.
            </p>
          </div>

          <div class="math-use-case-block">
            <p class="math-use-case-label">Unit conversions:</p>
            <p class="math-use-case-note">Convert numeric scales into rem units by dividing by a base token value.</p>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

/**
 * Startup entry point for the Test Object component.
 *
 * The component has no service logic yet, so starting it does exactly one
 * observable thing: it announces itself on stdout. That single line is what
 * proves the component was launched.
 */

/**
 * Starts the Test Object by announcing itself on stdout.
 *
 * @returns {void}
 */
export function start() {
  console.log('TEST');
}

start();

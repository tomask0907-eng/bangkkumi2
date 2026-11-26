// Copy to <site-root>/api/bangbom-interpret.mjs for a static Vercel project.
// Keep <site-root>/vendor/bangbom-chat/{src,server,package.json} for this import.
import interpreter from '../vendor/bangbom-chat/server/interpret.cjs';
export default interpreter.createHandler();

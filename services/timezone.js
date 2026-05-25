/**
 * Configuración central de zona horaria del negocio.
 *
 * Para cambiar la zona horaria del sistema completo, modifica solo este archivo
 * (o la variable de entorno APP_TZ en el .env / docker-compose).
 *
 * Importante: la BD sigue guardando timestamps en UTC. Esta zona es para:
 *   - Comparar fechas calendario (DATE) contra timestamps
 *   - Mostrar fechas/horas al usuario
 */
const TZ = process.env.APP_TZ || 'America/Guayaquil';

module.exports = { TZ };

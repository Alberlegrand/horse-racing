/**
 * Middleware pour logging d'audit automatique
 * Enregistre automatiquement toutes les actions utilisateur
 */

import { logAction } from '../config/db-strategy.js';

/**
 * Middleware d'audit
 * À ajouter après les routes pour enregistrer les actions
 */
export function auditMiddleware(req, res, next) {
  // Capturer la méthode send originale
  const originalSend = res.send;

  res.send = function(data) {
    // Enregistrer l'action si succès (status 200-299)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const userId = req.user?.userId || 'anonymous';
      const method = req.method;
      const path = req.path;
      const ip = req.ip;

      // Déterminer le type d'action basé sur la route
      let action = 'UNKNOWN';
      let entityType = null;
      let entityId = null;

      if (path.includes('/receipts')) {
        if (method === 'POST') {
          action = 'TICKET_CREATED';
          entityType = 'RECEIPT';
          try {
            const parsedData = JSON.parse(data);
            entityId = parsedData?.data?.id || null;
          } catch (e) {
            // Ignorer les erreurs de parsing
          }
        } else if (method === 'DELETE') {
          action = 'TICKET_DELETED';
          entityType = 'RECEIPT';
          entityId = req.query.id || null;
        }
      } else if (path.includes('/rounds')) {
        if (method === 'POST') {
          action = 'ROUND_STARTED';
          entityType = 'ROUND';
        }
      }

      // Enregistrer dans PostgreSQL (asynchrone, non-bloquant)
      if (action !== 'UNKNOWN' && entityType && entityId) {
        logAction(userId, action, entityType, entityId, {}, ip).catch(err => {
          console.error('[AUDIT] Erreur logging:', err.message);
        });
      }
    }

    // Appeler la méthode send originale
    return originalSend.call(this, data);
  };

  next();
}

export default auditMiddleware;

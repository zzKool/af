import type { Dictionary } from "./en";

export const fr: Dictionary = {
  "common.save": "Enregistrer",
  "common.cancel": "Annuler",
  "common.delete": "Supprimer",
  "common.add": "Ajouter",
  "common.edit": "Modifier",
  "common.open": "Ouvrir",
  "common.today": "Aujourd'hui",

  "contracts.currentRate": "Tarif actuel",
  "contracts.currentRate.none": "Aucun tarif aujourd'hui",
  "contracts.currency.lockedHint":
    "Des tarifs existent dans cette devise — créez un second contrat pour une autre devise.",

  "contracts.rates.title": "Tarifs",
  "contracts.rates.validFrom": "Valide du",
  "contracts.rates.validTo": "Valide jusqu'au",
  "contracts.rates.rate": "Tarif",
  "contracts.rates.unit": "Unité",
  "contracts.rates.unit.day": "jour",
  "contracts.rates.note": "Note",
  "contracts.rates.open": "En cours",
  "contracts.rates.state.current": "Actuel",
  "contracts.rates.state.expired": "Expiré",
  "contracts.rates.state.future": "À venir",
  "contracts.rates.empty": "Aucun tarif",
  "contracts.rates.add": "Ajouter un tarif",
  "contracts.rates.tip": "Laisser « valide jusqu'au » vide pour un tarif en cours.",
  "contracts.rates.added": "Tarif ajouté",
  "contracts.rates.updated": "Tarif mis à jour",
  "contracts.rates.deleted": "Tarif supprimé",
  "contracts.rates.deleteConfirm.title": "Supprimer le tarif",
  "contracts.rates.deleteConfirm.description":
    "Supprimer le tarif {rate} valide du {from} ? Un tarif utilisé sur une facture ne peut pas être supprimé.",
  "contracts.rates.error.amount": "Un montant valide est requis",
  "contracts.rates.error.validFrom": "La date de début est requise",
  "contracts.rates.error.validTo":
    "La date de fin doit être égale ou postérieure à la date de début",
  "contracts.rates.error.overlap": "Ce tarif chevauche un tarif existant ({from} → {to})",
  "contracts.rates.error.inUse":
    "Ce tarif est utilisé sur {n} ligne(s) de facture et ne peut pas être supprimé — clôturez-le",
};

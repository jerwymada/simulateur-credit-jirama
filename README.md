# Simulateur de crédit JIRAMA

Prototype autonome en HTML, CSS et JavaScript pour simuler un achat de crédit prépayé :

- saisie par quantité de kWh ou par budget en Ariary ;
- prise en compte des kWh déjà achetés dans le mois ;
- calcul cumulatif des première, deuxième et troisième tranches ;
- prime fixe et redevance prélevées une seule fois par mois ;
- estimation des taxes et de la TVA ;
- ajout manuel d'un arriéré ou d'une régularisation communiqué par JIRAMA ;
- historique local par compteur et par mois ;
- interface compacte et adaptée aux petits écrans.

## Lancer le projet

Ouvrir simplement `index.html` dans un navigateur moderne.

## Modèle tarifaire utilisé

Le prototype utilise le tarif résidentiel économique JIRAMA / ORE :

- première tranche : 0 à 130 kWh par mois à 340 Ar/kWh ;
- deuxième tranche : de 130 à 300 kWh par mois à 560 Ar/kWh ;
- troisième tranche : au-delà de 300 kWh par mois à 764 Ar/kWh ;
- prime fixe : 3 018 Ar par kW souscrit et par mois ;
- redevance : 8 000 Ar par mois ;
- taxe communale : 6 % du montant de consommation ;
- surtaxe communale : 4 % ;
- FNE : 1,25 %.

Pour une puissance souscrite de 3,3 kW, la prime fixe vaut :

`3 018 × 3,3 = 9 959,40 Ar`

## TVA : hypothèse de calcul

L'estimation de TVA utilise la règle suivante :

- aucune TVA tant que le cumul mensuel reste inférieur ou égal à 100 kWh ;
- au-delà de 100 kWh, TVA de 20 % sur la base taxable cumulée, après retrait de 34 000 Ar correspondant aux 100 premiers kWh à 340 Ar.

Cette règle est une **estimation** et ne constitue pas une confirmation officielle de la méthode interne JIRAMA.

## Arriéré / régularisation

Si JIRAMA communique un montant à prélever, il peut être saisi manuellement et sera ajouté au total de l'achat. Le simulateur ne tente pas de le calculer automatiquement.


## Sources de recherche

- ORE, tarifs JIRAMA OPTIMA Résidentiel en vigueur depuis juin 2021 : https://www.ore.mg/DonneesTechniques/TarifsAppliques/Jirama2023Janvier.html
- ORE, définitions de la prime fixe et de la redevance mensuelle : https://www.ore.mg/jargon.html
- JIRAMA, compteurs intelligents avec prépaiement et fonctionnement multi-tarifaire : https://www.jirama.mg/electricite/

## Fichiers

- `index.html` : interface ;
- `styles.css` : design responsive ;
- `app.js` : logique tarifaire, budget, historique et jeton ;
- `README.md` : méthodologie et limites.

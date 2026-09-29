import { textMatchesAnyKeyword } from './keyword-match.util';

const KW = [
  'informatiq',
  'TIC',
  'ERP',
  'ANTIC',
  'CAMTEL',
  'télécom',
  'logiciel',
  'cybersécurité',
  'réseau informatique',
];

describe('textMatchesAnyKeyword', () => {
  it('matche un vrai titre IT', () => {
    expect(
      textMatchesAnyKeyword('Fourniture de matériel informatique', KW),
    ).toBe(true);
    expect(
      textMatchesAnyKeyword("Développement d'un logiciel de gestion", KW),
    ).toBe(true);
  });

  it('radical : "informatiq" matche "informatiques"', () => {
    expect(
      textMatchesAnyKeyword('Maintenance des systèmes informatiques', KW),
    ).toBe(true);
  });

  it('sigle court "TIC" en mot entier seulement', () => {
    expect(
      textMatchesAnyKeyword('Acquisition de matériel TIC pour les écoles', KW),
    ).toBe(true);
    // "diagnostic" contient "tic" mais en milieu de mot → ne doit PAS matcher
    expect(
      textMatchesAnyKeyword("Acquisition d'équipements de diagnostic médical", KW),
    ).toBe(false);
  });

  it('sigle "ERP" ne matche pas "interprétation"', () => {
    expect(
      textMatchesAnyKeyword('Services d\'interprétation simultanée', KW),
    ).toBe(false);
    expect(textMatchesAnyKeyword('Déploiement d\'un ERP financier', KW)).toBe(true);
  });

  it('insensible aux accents', () => {
    expect(
      textMatchesAnyKeyword('Extension du reseau telecom regional', KW),
    ).toBe(true);
    expect(textMatchesAnyKeyword('Audit de cybersecurite', KW)).toBe(true);
  });

  it('rejette les titres non-IT', () => {
    expect(
      textMatchesAnyKeyword("Construction d'un bâtiment administratif R+2", KW),
    ).toBe(false);
    expect(
      textMatchesAnyKeyword('Acquisition de véhicules 4x4 tout terrain', KW),
    ).toBe(false);
    expect(
      textMatchesAnyKeyword('Travaux de réhabilitation de la route nationale', KW),
    ).toBe(false);
  });

  it('robustesse : liste vide / texte vide', () => {
    expect(textMatchesAnyKeyword('peu importe', [])).toBe(false);
    expect(textMatchesAnyKeyword('', KW)).toBe(false);
  });
});

/** Données brutes extraites des listes ARMP (équivalent `webscraping/src/scraper.js`). */
export type ArmpTender = {
  id: string;
  typePublication: string;
  idPublication: string;
  title: string;
  authority: string;
  type: string;
  region: string;
  amount: string;
  publishedOn: string;
  closingDate: string;
  closingTime: string;
  detailUrl: string;
  downloadLink: string;
  source: string;

  /** UUID interne du PDF téléchargé (si filtré et téléchargé via pipeline). */
  internalFileId?: string;
};

export type ArmpSource = {
  name: string;
  url: string;
};

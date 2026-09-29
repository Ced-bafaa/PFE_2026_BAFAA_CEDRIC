import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('opportunity_submission_justificatif')
export class OpportunitySubmissionJustificatifEntity {
  @PrimaryColumn({ name: 'opportunity_id', type: 'varchar', length: 255 })
  opportunityId!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 512 })
  fileName!: string;

  @Column({ name: 'pdf_data', type: 'longblob' })
  pdfData!: Buffer;
}

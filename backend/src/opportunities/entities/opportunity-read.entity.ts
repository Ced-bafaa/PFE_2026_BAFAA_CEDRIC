import { Entity, PrimaryColumn } from 'typeorm';

@Entity('opportunity_reads')
export class OpportunityReadEntity {
  @PrimaryColumn({ name: 'opportunity_id', type: 'varchar', length: 255 })
  opportunityId!: string;
}

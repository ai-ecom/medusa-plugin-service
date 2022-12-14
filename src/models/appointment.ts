import {
    BeforeInsert,
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    Generated
} from "typeorm"

import { Order, LineItem, SoftDeletableEntity } from "@medusajs/medusa";
import { DbAwareColumn, resolveDbGenerationStrategy } from "@medusajs/medusa/dist/utils/db-aware-column";
import { generateEntityId } from "@medusajs/medusa/dist/utils";

export enum AppointmentStatus {
    DRAFT = 'draft',
    SCHEDULED = 'scheduled',
    CANCELED = 'canceled',
    REQUIRES_ACTION = 'requires_action',
    PENDING = 'pending',
    RESCHEDULE = 'reschedule',
    ON_PROGRESS = 'on_progress',
    FINISHED = 'finished'
}

@Entity()
export class Appointment extends SoftDeletableEntity {
    @Index()
    @DbAwareColumn({ type: "enum", enum: AppointmentStatus, default: "draft" })
    status: AppointmentStatus

    @Index()
    @Column()
    @Generated(resolveDbGenerationStrategy("increment"))
    display_id: number

    @Column({ type: "timestamp with time zone", nullable: true })
    notified_via_email_at: Date | null
  
    @Column({ type: "timestamp with time zone", nullable: true })
    notified_via_sms_at: Date | null

    @Column({ type: "timestamp with time zone", nullable: true })
    from: Date | null
  
    @Column({ type: "timestamp with time zone", nullable: true })
    to: Date | null

    @OneToMany(() => LineItem, (lineItem) => lineItem.order, {
        cascade: ["insert"],
    })
    items: LineItem[]

    @Column({ type: "varchar", nullable: true })
    order_id: string | null
  
    @ManyToOne(() => Order)
    @JoinColumn({ name: "order_id" })
    order: Order | null

    @Column({ type: "varchar", nullable: true })
    code: string | null

    @Column({ type: "boolean"})
    is_confirmed: boolean

    @DbAwareColumn({ type: "jsonb", nullable: true })
    metadata: Record<string, unknown>
  
    @BeforeInsert()
    private beforeInsert(): void {
        this.id = generateEntityId(this.id, "apnt")
        this.code = generateEntityId(this.code)
    }
}
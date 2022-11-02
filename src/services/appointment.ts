import { EventBusService, TransactionBaseService } from '@medusajs/medusa';
import { formatException } from '@medusajs/medusa/dist/utils/exception-formatter';
import { buildQuery } from '@medusajs/medusa/dist/utils/build-query';
import { MedusaError } from "medusa-core-utils"
import { EntityManager } from "typeorm"
import { AppointmentRepository } from "../repositories/appointment";
import { Appointment } from '../models/appointment';
import { CreateAppointmentInput, UpdateAppointmentInput } from '../types/appointment';
import { setMetadata } from '@medusajs/medusa/dist/utils';
import { FindConfig, Selector } from '@medusajs/medusa/dist/types/common';

type InjectedDependencies = {
    manager: EntityManager
    appointmentRepository: typeof AppointmentRepository
    eventBusService: EventBusService
}

class AppointmentService extends TransactionBaseService {
    protected manager_: EntityManager
    protected transactionManager_: EntityManager | undefined

    protected readonly appointmentRepository_: typeof AppointmentRepository
    protected readonly eventBus_: EventBusService

    static readonly IndexName = `appointments`
    static readonly Events = {
        UPDATED: "appointment.updated",
        CREATED: "appointment.created",
        DELETED: "appointment.deleted",
    }

    constructor({ manager, appointmentRepository, eventBusService }: InjectedDependencies) {
        super(arguments[0]);

        this.manager_ = manager;
        this.appointmentRepository_ = appointmentRepository;
        this.eventBus_ = eventBusService;
    }

    async list(
        selector: Selector<Appointment>,
        config: FindConfig<Appointment> = {
          skip: 0,
          take: 50,
          relations: [],
        }
      ): Promise<Appointment[]> {
        const appointmentRepo = this.manager_.getCustomRepository(this.appointmentRepository_)
    
        const query = buildQuery(selector, config)
    
        return appointmentRepo.find(query)
    }

    async retrieve(appointmentId, config) {
        return await this.retrieve_({ id: appointmentId }, config)
    }

    async retrieve_(selector, config) {
        const manager = this.manager_
        const appointmentRepo = manager.getCustomRepository(this.appointmentRepository_)

        const { relations, ...query } = buildQuery(selector, config)

        const appointment = await appointmentRepo.findOneWithRelations(
            relations,
            query
        )

        if (!appointment) {
            const selectorConstraints = Object.entries(selector)
                .map(([key, value]) => `${key}: ${value}`)
                .join(", ")

            throw new MedusaError(
                MedusaError.Types.NOT_FOUND,
                `Appointment with ${selectorConstraints} was not found`
            )
        }

        return appointment
    }

    async create(appointmentObject: CreateAppointmentInput): Promise<Appointment> {
        return await this.atomicPhase_(async (manager) => {
            const appointmentRepo = manager.getCustomRepository(this.appointmentRepository_)

            const {
                ...rest
            } = appointmentObject

            try {
                let appointment: any = appointmentRepo.create(rest)
                appointment = await appointmentRepo.save(appointment)

                const result = await this.retrieve(appointment.id, {
                    relations: ["order"],
                })

                await this.eventBus_
                    .withTransaction(manager)
                    .emit(AppointmentService.Events.CREATED, {
                        id: result.id,
                    })
                return result
            } catch (error) {
                throw formatException(error)
            }
        })
    }

    async delete(appointmentId: string): Promise<void> {
        return await this.atomicPhase_(async (manager) => {
            const appointmentRepo = manager.getCustomRepository(this.appointmentRepository_)

            const appointment = await appointmentRepo.findOne(
                { id: appointmentId },
                { relations: ["order"] }
            )

            if (!appointment) {
                return
            }

            await appointmentRepo.softRemove(appointment)

            await this.eventBus_
                .withTransaction(manager)
                .emit(AppointmentService.Events.DELETED, {
                    id: appointmentId,
                })

            return Promise.resolve()
        })
    }

    async update(
        appointmentId: string,
        update: UpdateAppointmentInput
    ): Promise<Appointment> {
        return await this.atomicPhase_(async (manager) => {
            const appointmentRepo = manager.getCustomRepository(this.appointmentRepository_)
            const relations = ["order"]

            const appointment = await this.retrieve(appointmentId, {
                relations,
            })

            const {
                metadata,
                ...rest
            } = update


            if (metadata) {
                appointment.metadata = setMetadata(appointment, metadata)
            }

            for (const [key, value] of Object.entries(rest)) {
                if (typeof value !== `undefined`) {
                    appointment[key] = value
                }
            }

            const result = await appointmentRepo.save(appointment)

            await this.eventBus_
                .withTransaction(manager)
                .emit(AppointmentService.Events.UPDATED, {
                    id: result.id,
                    fields: Object.keys(update),
                })
            return result
        })
    }
}

export default AppointmentService;
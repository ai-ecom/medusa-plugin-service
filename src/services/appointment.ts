import {
  EventBusService,
  LineItem,
  OrderService,
  TransactionBaseService,
} from "@medusajs/medusa";
import { formatException } from "@medusajs/medusa/dist/utils/exception-formatter";
import { buildQuery } from "@medusajs/medusa/dist/utils/build-query";
import { MedusaError } from "medusa-core-utils";
import { EntityManager } from "typeorm";
import { AppointmentRepository } from "../repositories/appointment";
import { Appointment, AppointmentStatus } from "../models/appointment";
import {
  CreateAppointmentInput,
  UpdateAppointmentInput,
} from "../types/appointment";
import { setMetadata } from "@medusajs/medusa/dist/utils";
import { FindConfig, Selector } from "@medusajs/medusa/dist/types/common";
import CalendarService from "./calendar";
import CalendarTimeperiodService from "./calendar-timeperiod";
import LocationService from "./location";
import { divideTimes } from "../utils/date-utils";
import { includes } from "lodash";

type InjectedDependencies = {
  manager: EntityManager;
  appointmentRepository: typeof AppointmentRepository;
  calendarService: CalendarService;
  calendarTimeperiodService: CalendarTimeperiodService;
  locationService: LocationService;
  orderService: OrderService;
  eventBusService: EventBusService;
};

class AppointmentService extends TransactionBaseService {
  protected manager_: EntityManager;
  protected transactionManager_: EntityManager | undefined;

  protected readonly appointmentRepository_: typeof AppointmentRepository;
  protected readonly eventBus_: EventBusService;
  protected readonly calendar_: CalendarService;
  protected readonly calendarTimeperiod_: CalendarTimeperiodService;
  protected readonly location_: LocationService;
  protected readonly order_: OrderService;

  static readonly IndexName = `appointments`;
  static readonly Events = {
    UPDATED: "appointment.updated",
    CREATED: "appointment.created",
    DELETED: "appointment.deleted",
  };

  constructor({
    manager,
    appointmentRepository,
    eventBusService,
    calendarService,
    calendarTimeperiodService,
    locationService,
    orderService,
  }: InjectedDependencies) {
    super(arguments[0]);

    this.manager_ = manager;
    this.appointmentRepository_ = appointmentRepository;
    this.eventBus_ = eventBusService;
    this.calendar_ = calendarService;
    this.calendarTimeperiod_ = calendarTimeperiodService;
    this.location_ = locationService;
    this.order_ = orderService;
  }

  async list(
    selector: Selector<Appointment>,
    config: FindConfig<Appointment> = {
      skip: 0,
      take: 50,
      relations: [],
    }
  ): Promise<[Appointment[], number]> {
    const appointmentRepo = this.manager_.getCustomRepository(
      this.appointmentRepository_
    );

    const query = buildQuery(selector, config);

    return appointmentRepo.findAndCount(query);
  }

  async retrieve(appointmentId: string, config: FindConfig<Appointment>) {
    const manager = this.manager_;
    const appointmentRepo = manager.getCustomRepository(
      this.appointmentRepository_
    );

    const appointment = await appointmentRepo.findOne(appointmentId, config);

    if (!appointment) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Appointment was ${appointmentId} not found`
      );
    }

    return appointment;
  }

  async create(
    appointmentObject: CreateAppointmentInput
  ): Promise<Appointment> {
    return await this.atomicPhase_(async (manager) => {
      const appointmentRepo = manager.getCustomRepository(
        this.appointmentRepository_
      );

      const { ...rest } = appointmentObject;

      try {
        let appointment: any = appointmentRepo.create(rest);
        appointment = await appointmentRepo.save(appointment);

        const result = await this.retrieve(appointment.id, {
          relations: ["order"],
        });

        await this.eventBus_
          .withTransaction(manager)
          .emit(AppointmentService.Events.CREATED, {
            id: result.id,
          });
        return result;
      } catch (error) {
        throw formatException(error);
      }
    });
  }

  async delete(appointmentId: string): Promise<void> {
    return await this.atomicPhase_(async (manager) => {
      const appointmentRepo = manager.getCustomRepository(
        this.appointmentRepository_
      );

      const appointment = await appointmentRepo.findOne(
        { id: appointmentId },
        { relations: ["order"] }
      );

      if (!appointment) {
        return;
      }

      await appointmentRepo.softRemove(appointment);

      await this.eventBus_
        .withTransaction(manager)
        .emit(AppointmentService.Events.DELETED, {
          id: appointmentId,
        });

      return Promise.resolve();
    });
  }

  async update(
    appointmentId: string,
    update: UpdateAppointmentInput
  ): Promise<Appointment> {
    return await this.atomicPhase_(async (manager) => {
      const appointmentRepo = manager.getCustomRepository(
        this.appointmentRepository_
      );
      const relations = ["order"];

      const appointment = await this.retrieve(appointmentId, {
        relations,
      });

      const { metadata, ...rest } = update;

      if (metadata) {
        appointment.metadata = setMetadata(appointment, metadata);
      }

      for (const [key, value] of Object.entries(rest)) {
        if (typeof value !== `undefined`) {
          appointment[key] = value;
        }
      }

      const result = await appointmentRepo.save(appointment);

      await this.eventBus_
        .withTransaction(manager)
        .emit(AppointmentService.Events.UPDATED, {
          id: result.id,
          fields: Object.keys(update),
        });
      return result;
    });
  }

  async getCurrent(division: string) {
    const manager = this.manager_;

    const selector: Selector<Appointment> = {};

    const hourInMs = 1000 * 60 * 60;
    const now = new Date();

    // Check in the previous and next 2 hours
    selector.from = new Date(now.getTime() - 2 * hourInMs);
    selector.to = new Date(now.getTime() + 2 * hourInMs);

    const appointmentRepo = manager.getCustomRepository(
      this.appointmentRepository_
    );

    const query = buildQuery(selector);
    const response = await appointmentRepo.findAndCount(query);

    const [appointmentList, _] = response;

    for (const appointment of appointmentList) {
      const { from, to } = appointment;

      const now = new Date().getTime();

      const isCurrentAppointment = now > from.getTime() && now < to.getTime();

      if (isCurrentAppointment) {
        /**
         * TODO: Check if this appointment is from the right divison
         * In the meta_data of the appointment should be a calendar_timeperiod id
         * Retrieve the calendar_timeperiod and check if the division is correct and assign this to the value
         */

        const isRightDivision = true;

        if (isRightDivision) {
          return appointment;

          // const appointment_ =  await this.retrieve(appointment.id, {
          //     relations: ["order"]
          // });
          //
          // appointment_.order = await this.order_.retrieve(appointment_.order.id, {relations: ["items"]})
        }
      }
    }
  }

  checkIfCurrent(appointment: Appointment, hourRange: number) {
    const { from, to } = appointment;
    const now = new Date().getTime();

    const range = hourRange * 1000 * 60 * 60;

    const minTime = from.getTime() - range;
    const maxTime = to.getTime() + range;

    if (now < minTime) return false;

    if (now > maxTime) return false;

    return true;
  }

  async isOrderHaveAppointment(orderId: string) {
    const [appointment, count] = await this.list({ order_id: orderId });
    let realCount = 0;
    for (const x of appointment) {
      if (x.status == AppointmentStatus.SCHEDULED) realCount += 1;
    }
    if (realCount > 0) return true;
    return false;
  }

  // calculate from and to appointment into slot time and check with available slot time
  isSlotTimeAvailable(from: Date, to: Date, availableSlotTime) {
    const divideBy = 5;
    const selectedTimeSlots = divideTimes(
      new Date(from),
      new Date(to),
      divideBy
    );

    for (const dateEntry of Object.entries(selectedTimeSlots)) {
      const [dateKey, dateTimeSlots] = dateEntry;

      // because availableSlotTime is object, then we find slotTime date with dateKey
      let availableSlotTime_ = availableSlotTime.filter(
        (slotTime) => slotTime.date == dateKey
      );
      availableSlotTime_ = availableSlotTime_[0].slot_times;

      // @ts-ignore
      for (const dateTimeSlot of dateTimeSlots) {
        // compare selectedTimeSlots with availableSlotTime_, if missing one in availableSlotTime then it will be return to false
        if (includes(availableSlotTime_, dateTimeSlot)) continue;
        return false;
      }
    }

    return true;
  }

  async makeAppointment(makeAppointmentInput: {
    order_id: string;
    location_id: string;
    calendar_id: string;
    slot_time: Date;
  }) {
    const { order_id, location_id, calendar_id, slot_time } =
      makeAppointmentInput;

    // check calendar exists or not
    await this.calendar_.retrieve(calendar_id, {});

    // check if order already have appointment
    const isOrderHaveAppointment = await this.isOrderHaveAppointment(order_id);
    if (isOrderHaveAppointment)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Order Already Have Appointment !",
        "400"
      );

    const location = await this.location_.retrieve(location_id, {
      relations: ["country", "company"],
    });
    const order = await this.order_.retrieve(order_id, {
      relations: ["items"],
    });

    // calculated duration_min on product general or variant
    const items_list: LineItem[] = order.items;
    let totalDurationMin: number = 0;

    for (const x of items_list) {
      let duration_min: number = 0;
      const variant_time: string = x.variant.metadata?.duration_min as string;
      const product_time: string = x.variant.product.metadata
        ?.duration_min as string;

      if (+variant_time > 0) {
        duration_min = +variant_time;
      } else {
        duration_min = +product_time;
      }

      totalDurationMin += duration_min;
    }

    // calculated slot_time + duration_min items
    const slot_time_until = new Date(
      new Date(slot_time).getTime() + totalDurationMin * 60 * 1000
    );

    // get slot time
    const today_time_slot = await this.location_.getSlotTime_(
      calendar_id,
      location_id,
      slot_time,
      slot_time_until
    );

    // is slot time available
    const isSlotTimeAvailable = this.isSlotTimeAvailable(
      slot_time,
      slot_time_until,
      today_time_slot
    );
    if (!isSlotTimeAvailable)
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Slot Time Not Available!",
        "404"
      );

    const dataInput = {
      order_id: order_id,
      is_confirmed: false,
      status: AppointmentStatus.DRAFT,
    };

    const ap = await this.create(dataInput);
    const appointment: Appointment = await this.retrieve(ap.id, {
      relations: ["order", "order.items"],
    });

    // create timeperiod
    const timeperiod = await this.calendarTimeperiod_.create({
      calendar_id: calendar_id,
      title: `Appointment for ${appointment.order_id}`,
      type: "blocked",
      from: new Date(slot_time),
      to: new Date(slot_time_until),
      metadata: {
        appointment_id: appointment.id,
      },
    });

    // update status to scheduled
    await this.update(appointment.id, {
      status: AppointmentStatus.SCHEDULED,
      from: new Date(slot_time),
      to: new Date(slot_time_until),
      metadata: {
        calendar_timeperiod_id: timeperiod.id,
        location: location,
      },
    });

    return await this.retrieve(appointment.id, {
      relations: ["order", "order.items"],
    });
  }
}

export default AppointmentService;

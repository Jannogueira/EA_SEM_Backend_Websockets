import { Server as SocketIOServer, Socket } from 'socket.io';
import Logging from '../library/Logging';
import MensajeModel, { IMensajeModel } from '../models/Mensaje';

export class MensajeService {
    private io: SocketIOServer;
    private usuariosConectados: Map<string, string[]> = new Map();

    constructor(io: SocketIOServer) {
        this.io = io;
    }

    /**
     * Inicializa los listeners de Socket.io
     */
    public inicializarSockets(): void {
        this.io.on('connection', (socket: Socket) => {
            Logging.info(`Socket conectado: ${socket.id} con usuario: ${socket.handshake.query.username}`);
            this.agregarConexionUsuario(socket.handshake.query.username as string, socket.id);
            this.io.emit('online-users', Array.from(this.usuariosConectados.keys()));

            /* 
            // Unirse a una sala de organización (DESACTIVADO PARA CHAT GLOBAL)
            socket.on('join-organization', (organizacionId: string) => {
                socket.join(`org-${organizacionId}`);
                Logging.info(`Socket ${socket.id} se unió a organización ${organizacionId}`);
            });
            */

            socket.on('typing', (data: { usuario: string }) => {
                Logging.info(`${data.usuario} está escribiendo...`);
                socket.broadcast.emit('user-typing', data);
            });

            socket.on('stop-typing', (data: { usuario: string }) => {
                Logging.info(`${data.usuario} dejó de escribir`);
                socket.broadcast.emit('user-stop-typing', data);
            });

            // Escuchar mensajes incoming
            socket.on('message', async (data: { usuario: string, organizacion: string, contenido: string }) => {
                try {
                    Logging.info(`Mensaje recibido de ${data.usuario}`);
                    
                    // Guardar el mensaje en la BD
                    const nuevoMensaje = await this.guardarMensaje(
                        data.contenido,
                        data.usuario,
                        data.organizacion
                    );

                    // Emitir el mensaje a TODOS los clientes conectados (Chat Global)
                    this.io.emit('message', nuevoMensaje);
                } catch (error) {
                    Logging.error(`Error al guardar mensaje: ${error}`);
                    socket.emit('error', { message: 'Error al guardar el mensaje' });
                }
            });

            // Marcar mensaje como leído
            socket.on('mark-as-read', async (mensajeId: string) => {
                try {
                    await MensajeModel.findByIdAndUpdate(mensajeId, { leido: true });
                    Logging.info(`Mensaje ${mensajeId} marcado como leído`);
                } catch (error) {
                    Logging.error(`Error al marcar mensaje como leído: ${error}`);
                }
            });

            socket.on('get-online-users', () => {
                Logging.info(`Usuarios conectados: ${this.usuariosConectados}`);
                socket.emit('online-users', Array.from(this.usuariosConectados.keys()));
            });

            // Desconexión
            socket.on('disconnect', () => {
                Logging.info(`Socket desconectado: ${socket.id}`);
                this.eliminarConexionUsuario(socket.handshake.query.username as string, socket.id);
                socket.broadcast.emit('online-users', Array.from(this.usuariosConectados.keys()));
            });
        });
    }

    /**
     * Guarda un nuevo mensaje en la base de datos
     */
    public async guardarMensaje(
        contenido: string,
        usuarioId: string,
        organizacionId: string
    ): Promise<IMensajeModel> {
        const mensaje = new MensajeModel({
            contenido,
            usuario: usuarioId,
            organizacion: organizacionId,
            leido: false
        });

        const savedMensaje = await mensaje.save();
        return await savedMensaje.populate('usuario', 'name email');
    }


    /**
     * Obtiene todos los mensajes de una organización
     */
    public async obtenerMensajesPorOrganizacion(organizacionId: string): Promise<IMensajeModel[]> {
        return await MensajeModel.find({ organizacion: organizacionId })
            .populate('usuario', 'name email')
            .sort({ createdAt: -1 });
    }

    /**
     * Obtiene los mensajes no leídos de un usuario
     */
    public async obtenerMensajesNoLeidos(usuarioId: string): Promise<IMensajeModel[]> {
        return await MensajeModel.find({ usuario: usuarioId, leido: false })
            .populate('usuario', 'name email')
            .populate('organizacion', 'name');
    }

    private agregarConexionUsuario(username: string, socketId: string) {
        if (this.usuariosConectados.has(username) && this.usuariosConectados.get(username)!.includes(socketId)) {
            return;
        }
        if (this.usuariosConectados.has(username)) {
            this.usuariosConectados.get(username)!.push(socketId);
        } else {
            this.usuariosConectados.set(username, [socketId]);
        }
    }

    private eliminarConexionUsuario(username: string, socketId: string) {
        if (!this.usuariosConectados.has(username)) {
            return;
        }
        if (this.usuariosConectados.get(username)!.length >= 1 && this.usuariosConectados.get(username)!.includes(socketId)) {
            this.usuariosConectados.get(username)!.splice(this.usuariosConectados.get(username)!.indexOf(socketId), 1);
        }
        if (this.usuariosConectados.get(username)!.length === 0)
            this.usuariosConectados.delete(username);
    }

}

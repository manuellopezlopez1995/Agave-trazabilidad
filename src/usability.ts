export const harvestStatus:Record<string,string>={
 PLANNED:'Programada',ASSIGNED:'Asignada',IN_PROGRESS:'En proceso',HARVESTED:'Jimada',CANCELLED:'Cancelada'
};

export const tripStatus:Record<string,string>={
 PENDING_DRIVER:'Pendiente de chofer',ASSIGNED:'Asignado',AT_FIELD:'En el predio',LOADING:'En carga',IN_TRANSIT:'En ruta',ARRIVED:'En destino',DELIVERED:'Entregado',CANCELLED:'Cancelado'
};

export const weighingName:Record<string,string>={ORIGIN:'Origen',DESTINATION:'Destino'};
export const labelStatus=(status:string,kind:'harvest'|'trip')=>(kind==='harvest'?harvestStatus:tripStatus)[status]??status.replaceAll('_',' ').toLocaleLowerCase('es-MX');

export function tripNextStep(status:string,hasOrigin:boolean,hasDestination:boolean,requiresSafety:boolean,safetyPhotos:number){
 switch(status){
  case 'PENDING_DRIVER':return 'Esperar asignación de chofer';
  case 'ASSIGNED':return 'Registrar llegada al predio';
  case 'AT_FIELD':return 'Iniciar carga';
  case 'LOADING':return hasOrigin?'Salir a ruta':'Fotografiar ticket de origen';
  case 'IN_TRANSIT':return requiresSafety&&safetyPhotos<2?`Sincronizar ${2-safetyPhotos} foto(s) de llegada`:'Registrar llegada al destino';
  case 'ARRIVED':return hasDestination?'Finalizar entrega':'Fotografiar ticket de destino';
  case 'DELIVERED':return 'Entrega terminada';
  default:return 'Consultar detalles';
 }
}

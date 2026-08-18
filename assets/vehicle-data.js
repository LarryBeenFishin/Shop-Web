window.SHOP_VEHICLE_DATA = {
  makes:["Acura","Audi","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","GMC","Honda","Hyundai","Infiniti","Jeep","Kia","Land Rover","Lexus","Lincoln","Mazda","Mercedes-Benz","Mini","Mitsubishi","Nissan","Porsche","Ram","Subaru","Tesla","Toyota","Volkswagen","Volvo"],
  models:{
    Acura:["Integra","MDX","RDX","TLX"],
    Audi:["A3","A4","A5","A6","Q3","Q5","Q7","Q8"],
    BMW:["2 Series","3 Series","4 Series","5 Series","X1","X3","X5","X7"],
    Buick:["Encore","Envision","Enclave"],
    Cadillac:["CT4","CT5","Escalade","XT4","XT5","XT6"],
    Chevrolet:["Silverado 1500","Malibu","Equinox","Tahoe","Traverse","Colorado","Suburban","Trailblazer","Trax"],
    Chrysler:["300","Pacifica","Voyager"],
    Dodge:["Charger","Durango","Grand Caravan"],
    Ford:["F-150","Escape","Explorer","Fusion","Edge","Mustang","Ranger","Bronco","Expedition","Maverick"],
    GMC:["Acadia","Canyon","Sierra 1500","Terrain","Yukon"],
    Honda:["Civic","Accord","CR-V","Pilot","Odyssey","HR-V","Ridgeline","Passport"],
    Hyundai:["Elantra","Sonata","Tucson","Santa Fe","Palisade","Kona","Venue","Santa Cruz"],
    Infiniti:["Q50","QX50","QX60","QX80"],
    Jeep:["Wrangler","Grand Cherokee","Cherokee","Compass","Renegade","Gladiator","Wagoneer"],
    Kia:["Forte","K5","Sorento","Sportage","Telluride","Soul","Carnival","Seltos"],
    "Land Rover":["Defender","Discovery","Range Rover","Range Rover Sport"],
    Lexus:["ES","GX","IS","LS","LX","NX","RX","UX"],
    Lincoln:["Aviator","Corsair","Navigator","Nautilus"],
    Mazda:["Mazda3","Mazda6","CX-30","CX-5","CX-50","CX-9","MX-5 Miata"],
    "Mercedes-Benz":["C-Class","E-Class","S-Class","GLA","GLC","GLE","GLS"],
    Mini:["Cooper","Countryman"],
    Mitsubishi:["Eclipse Cross","Mirage","Outlander","Outlander Sport"],
    Nissan:["Altima","Sentra","Rogue","Pathfinder","Murano","Frontier","Versa","Titan","Armada"],
    Porsche:["911","Cayenne","Macan","Panamera","Taycan"],
    Ram:["1500","2500","3500","ProMaster"],
    Subaru:["Ascent","BRZ","Crosstrek","Forester","Impreza","Legacy","Outback","WRX"],
    Tesla:["Model 3","Model S","Model X","Model Y","Cybertruck"],
    Toyota:["Camry","Corolla","RAV4","Highlander","Tacoma","Tundra","Prius","Sienna","4Runner","Venza"],
    Volkswagen:["Atlas","Golf","GTI","Jetta","Taos","Tiguan"],
    Volvo:["S60","S90","XC40","XC60","XC90"]
  },
  currentYears(){
    const newest=new Date().getFullYear()+1;
    return Array.from({length:newest-1980+1},(_,i)=>String(newest-i));
  }
};

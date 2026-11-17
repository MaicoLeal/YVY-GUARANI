/*
 * Catálogo inicial de productos, tomado de la tienda en línea de Ecoagro (ecoagro.org.py, noviembre de 2026).
 * - Nombres, presentaciones y fotos: de esa tienda. Algunas líneas son marcas que Ecoagro comercializa (se indica la marca).
 * - Descripciones, historias y recetas: textos propios de Yvy Guaraní para la tienda; la cooperativa puede reemplazarlos.
 * - Sin precios: se definen más adelante. Sin datos de stock: el stock nace de cada recepción.
 * - Antes de publicar, confirmar con Ecoagro el uso de las fotos y la asignación de cada producto.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YvyCatalogo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CATEGORIES = [
    { id: 'CAT-PASTAS', name: 'Pastas', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-ESPECIAS', name: 'Especias y condimentos', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-MIELES', name: 'Mieles', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-GRANOS', name: 'Granos y semillas', requiresExpiry: false, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-HARINAS', name: 'Harinas', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-YUYOS', name: 'Yuyos y hierbas', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-ALMACEN', name: 'Almacén', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-DULCES', name: 'Dulces y untables', requiresExpiry: true, requiresDoc: false, fueraDePiloto: false, qualityNote: '' },
    { id: 'CAT-FRESCOS', name: 'Frescos y perecederos', requiresExpiry: true, requiresDoc: true, fueraDePiloto: true, qualityNote: '' }
  ];

  // [id de la tienda de origen, nombre, categoría, presentación, marca, descripción]
  var ROWS = [
    [2148, 'Spaghetti de remolacha', 'CAT-PASTAS', '300 g', 'La Divina Pastas', 'Pasta seca artesanal de trigo con remolacha, que le da su color. Sin colorantes ni conservantes agregados.'],
    [2146, 'Spaghetti de acelga', 'CAT-PASTAS', '300 g', 'La Divina Pastas', 'Pasta seca artesanal de trigo con acelga. Sin colorantes ni conservantes agregados.'],
    [1967, 'Spaghetti de calabaza', 'CAT-PASTAS', '300 g', 'La Divina Pastas', 'Pasta seca artesanal de trigo con calabaza, de sabor suave y color dorado.'],
    [1814, 'Spaghetti de espinaca', 'CAT-PASTAS', '300 g', 'La Divina Pastas', 'Pasta seca artesanal de trigo con espinaca. Combina muy bien con salsas de tomate.'],
    [1810, 'Spaghetti de zanahoria', 'CAT-PASTAS', '300 g', 'La Divina Pastas', 'Pasta seca artesanal de trigo con zanahoria, de sabor dulce y suave.'],
    [3587, 'Pasta de cúrcuma y pimienta', 'CAT-PASTAS', '250 g', '', 'Pasta seca con cúrcuma y pimienta, para platos con un toque especiado.'],
    [4036, 'Conchiglioni de cúrcuma y semolín', 'CAT-PASTAS', '400 g', '', 'Caracoles grandes de semolín con cúrcuma, ideales para rellenar o gratinar.'],
    [942, 'Cúrcuma en polvo', 'CAT-ESPECIAS', '50 g', '', 'Raíz de cúrcuma secada y molida. Da color y aroma a arroces, guisos y caldos.'],
    [944, 'Jengibre en polvo', 'CAT-ESPECIAS', '50 g', '', 'Raíz de jengibre secada y molida, de sabor picante y fresco.'],
    [946, 'Pimiento dulce en polvo', 'CAT-ESPECIAS', '50 g', '', 'Pimiento rojo secado y molido, de sabor dulce, para condimentar carnes, guisos y salsas.'],
    [948, 'Kuratu molido', 'CAT-ESPECIAS', '100 g', '', 'Semillas de kuratu (cilantro) molidas, de aroma cítrico.'],
    [950, 'Kuratu en grano', 'CAT-ESPECIAS', '100 g', '', 'Semillas enteras de kuratu (cilantro), para moler en el momento.'],
    [959, 'Moringa en polvo', 'CAT-ESPECIAS', '30 g', '', 'Hojas de moringa secadas y molidas, para agregar a jugos, batidos o sopas.'],
    [2124, 'Ají rojo del monte', 'CAT-ESPECIAS', '50 g', '', 'Ají picante secado. Usar con medida: pica bastante.'],
    [889, 'Anís', 'CAT-ESPECIAS', '25 g', '', 'Semillas de anís, el aroma clásico de la chipa.'],
    [961, 'Miel de abeja', 'CAT-MIELES', '180 g', '', 'Miel de abeja pura, en presentación chica.'],
    [963, 'Miel de abeja', 'CAT-MIELES', '350 g', '', 'Miel de abeja pura.'],
    [966, 'Miel de abeja', 'CAT-MIELES', '700 g', '', 'Miel de abeja pura, en presentación familiar.'],
    [969, 'Miel de abeja con propóleo', 'CAT-MIELES', '180 g', 'Ecoagro', 'Miel de abeja con propóleo.'],
    [725, 'Miel de abeja', 'CAT-MIELES', '1,2 kg', '', 'Miel de abeja pura, en presentación grande.'],
    [738, 'Chía', 'CAT-GRANOS', '250 g', '', 'Semillas de chía, para agregar a jugos, yogures, panes y postres.'],
    [1031, 'Poroto San Francisco', 'CAT-GRANOS', '500 g', '', 'Poroto de grano mediano, para guisos y ensaladas.'],
    [1029, 'Poroto rojo', 'CAT-GRANOS', '500 g', '', 'Poroto rojo, para guisos, sopas y ensaladas.'],
    [778, 'Poroto negro', 'CAT-GRANOS', '500 g', '', 'Poroto negro, para guisos y acompañamientos.'],
    [732, 'Lenteja', 'CAT-GRANOS', '500 g', '', 'Lentejas para guisos, sopas y ensaladas.'],
    [728, 'Locrillo', 'CAT-GRANOS', '500 g', '', 'Maíz blanco quebrado, la base del locro y del jopara.'],
    [742, 'Maní tostado', 'CAT-GRANOS', '500 g', '', 'Maní tostado, para picar o para preparar ka’i ladrillo y otros dulces.'],
    [772, 'Maíz pororó', 'CAT-GRANOS', '500 g', '', 'Maíz para hacer pororó en casa.'],
    [2389, 'Soja orgánica', 'CAT-GRANOS', '500 g', '', 'Granos de soja, para cocinar o preparar bebida vegetal.'],
    [780, 'Harina de mandioca', 'CAT-HARINAS', '500 g', '', 'Harina de mandioca, para panificados y rebozados.'],
    [793, 'Harina de remolacha', 'CAT-HARINAS', '250 g', '', 'Remolacha deshidratada y molida, para dar color y sabor a masas y batidos.'],
    [795, 'Harina de zanahoria', 'CAT-HARINAS', '250 g', '', 'Zanahoria deshidratada y molida, para masas, tortas y sopas.'],
    [808, 'Harina de garbanzo', 'CAT-HARINAS', '500 g', '', 'Harina de garbanzo, para fainá, rebozados y tortillas.'],
    [784, 'Harina de chía', 'CAT-HARINAS', '250 g', '', 'Semillas de chía molidas, para panes, galletitas y batidos.'],
    [828, 'Harina de batata', 'CAT-HARINAS', '500 g', '', 'Batata deshidratada y molida, de sabor dulce, para masas y postres.'],
    [901, 'Cedrón Paraguay', 'CAT-YUYOS', '25 g', '', 'Hojas secas de cedrón Paraguay, de aroma a limón, para tereré, mate o infusión.'],
    [915, 'Ka’are', 'CAT-YUYOS', '25 g', '', 'Yuyo seco tradicional para el tereré y el mate.'],
    [909, 'Jaguarete ka’a', 'CAT-YUYOS', '25 g', '', 'Yuyo seco tradicional, de sabor amargo, para mate e infusiones.'],
    [911, 'Jatei ka’a', 'CAT-YUYOS', '25 g', '', 'Yuyo seco tradicional para el tereré y el mate.'],
    [919, 'Manzanilla', 'CAT-YUYOS', '25 g', '', 'Flores secas de manzanilla para infusión.'],
    [923, 'Moringa en hojas', 'CAT-YUYOS', '25 g', '', 'Hojas secas de moringa para infusión.'],
    [929, 'Stevia en hojas', 'CAT-YUYOS', '25 g', '', 'Hojas secas de ka’a he’ẽ (stevia), de sabor dulce, para endulzar infusiones y tereré.'],
    [899, 'Cangorosa', 'CAT-YUYOS', '25 g', '', 'Yuyo seco tradicional para mate e infusiones.'],
    [895, 'Boldo', 'CAT-YUYOS', '25 g', '', 'Hojas secas de boldo para infusión.'],
    [913, 'Flor de tilo', 'CAT-YUYOS', '25 g', '', 'Flores secas de tilo para infusión.'],
    [1035, 'Maní ku’i', 'CAT-ALMACEN', '500 g', '', 'Maní tostado y molido, para el kesu paraguay con maní, el mbeju y postres.'],
    [1033, 'Fariña', 'CAT-ALMACEN', '500 g', '', 'Fariña de mandioca tostada, para acompañar asados y preparar farofa.'],
    [770, 'Almidón de mandioca', 'CAT-ALMACEN', '500 g', '', 'Almidón de mandioca, el ingrediente de la chipa y el mbeju.'],
    [975, 'Dulce de guayaba', 'CAT-DULCES', '900 g', '', 'Dulce de guayaba en pasta, para acompañar con queso Paraguay.'],
    [740, 'Dulce de mamón', 'CAT-DULCES', '900 g', '', 'Mamón en almíbar, el postre de la casa paraguaya.'],
    [989, 'Mantequilla de maní', 'CAT-DULCES', '400 g', '', 'Pasta de maní para untar, para el desayuno y la merienda.']
  ];

  // Sellos tal como los declara la tienda de origen. Se muestran como "declarado por el proveedor" hasta validarlos.
  var CLAIMS = {"725":["Artesanal","Sin colorantes","Sin conservantes"],"738":["Orgánico (Paraguay)"],"740":["Orgánico (Paraguay)"],"742":["Orgánico (Paraguay)"],"770":["Orgánico (Paraguay)"],"772":["Orgánico (Paraguay)"],"778":["Orgánico (Paraguay)"],"780":["Orgánico (Paraguay)"],"784":["Orgánico (Paraguay)","Sin gluten","Vegano"],"793":["Orgánico (Paraguay)","Sin gluten","Vegano"],"795":["Sin gluten","Vegano"],"808":["Sin gluten","Vegano"],"828":["Orgánico (Paraguay)","Sin gluten","Vegano"],"889":["Artesanal"],"895":["Artesanal"],"899":["Artesanal"],"901":["Artesanal"],"909":["Artesanal"],"913":["Artesanal"],"919":["Artesanal"],"942":["Orgánico (Paraguay)"],"944":["Orgánico (Paraguay)","Sin conservantes","Sin gluten","Vegano"],"946":["Orgánico (Paraguay)","Sin conservantes","Sin gluten","Vegano"],"948":["Orgánico (Paraguay)","Sin conservantes","Sin gluten","Vegano"],"950":["Orgánico (Paraguay)","Sin conservantes","Sin gluten","Vegano"],"959":["Orgánico (Paraguay)","Sin conservantes","Sin gluten","Vegano"],"961":["Artesanal"],"963":["Artesanal"],"966":["Artesanal"],"969":["Artesanal"],"975":["Orgánico (Paraguay)","Sin conservantes","Sin gluten","Vegano"],"989":["Orgánico (Paraguay)","Sin azúcar","Sin conservantes","Sin gluten","Vegano"],"1029":["Orgánico (Paraguay)","Vegano"],"1031":["Orgánico (Paraguay)","Vegano"],"1033":["Vegano"],"1035":["Orgánico (Paraguay)","Sin conservantes","Sin gluten","Vegano"],"1810":["Sin colorantes","Sin conservantes"],"1814":["Sin colorantes","Sin conservantes"],"1967":["Sin colorantes","Sin conservantes"],"2146":["Sin colorantes","Sin conservantes"],"2148":["Sin colorantes","Sin conservantes"],"3587":["Artesanal","Sin gluten"]};
  // Productos marcados en la tienda de origen como línea propia "Eco Agro Naturalmente".
  var OWN_LINE = [942,946,948,950,959,961,963,966,725,738,1031,1029,778,742,772,780,793,795,808,784,828,1035,1033,770,975,740,989];

  // Historias breves sobre el producto (contenido general; la cooperativa puede contar la suya).
  var STORIES = {
    2148: 'La remolacha le da a esta pasta su color intenso, sin colorantes agregados. Es una forma simple de sumar verduras a la mesa de todos los días, con el mismo tiempo de cocción de un spaghetti común.',
    2146: 'La acelga es una de las verduras de hoja más presentes en las huertas familiares. En esta pasta aporta su color verde y un sabor suave que combina con salsas de crema o de tomate.',
    1967: 'La calabaza y el zapallo son parte de la cocina paraguaya de siempre, del kiveve a los guisos. En esta pasta dan un color dorado y un sabor apenas dulce.',
    1814: 'Pasta verde de espinaca, pensada para quienes buscan algo distinto sin complicarse: se cocina como cualquier spaghetti y queda muy bien con una salsa de tomate casera.',
    1810: 'La zanahoria le da a esta pasta un color naranja y un sabor dulce que gusta mucho a los chicos.',
    942: 'La cúrcuma es una raíz de la familia del jengibre. Seca y molida, tiñe de amarillo el arroz y los caldos y tiene un sabor cálido, apenas amargo. Una pizca alcanza.',
    944: 'El jengibre seco y molido conserva el picor de la raíz fresca. Se usa en infusiones, en adobos y en masas dulces como galletitas y bizcochuelos.',
    948: 'El kuratu es el nombre guaraní del cilantro. Sus semillas molidas tienen un aroma cítrico que se luce en guisos, lentejas y adobos.',
    963: 'La miel es el trabajo de las abejas sobre las flores del monte y de las chacras. Su color y su sabor cambian según la floración de cada época del año.',
    738: 'La chía es una semilla pequeña que absorbe varias veces su peso en líquido y forma un gel. Por eso sirve para espesar postres, jugos y yogures sin cocinar.',
    1029: 'El poroto es parte de la base de la comida del campo paraguayo. Dejarlo en remojo la noche anterior acorta la cocción y lo hace más tierno.',
    780: 'La mandioca es la raíz central de la cocina paraguaya. Hecha harina, permite preparar panificados sin trigo.',
    770: 'Del almidón de mandioca salen la chipa y el mbeju, dos íconos de la mesa paraguaya. Es el ingrediente que les da su textura elástica.',
    1035: 'El maní ku’i es maní tostado y molido. Se usa en el mbeju, en dulces caseros y para espesar salsas.',
    901: 'El cedrón Paraguay es uno de los yuyos más queridos para el tereré: sus hojas tienen un perfume a limón que refresca el agua.',
    740: 'El dulce de mamón es un clásico de las casas paraguayas, y se sirve tradicionalmente con un trozo de queso Paraguay.',
    742: 'El maní tostado es la base del ka’i ladrillo, el dulce de maní con miel que se vende en las ferias y en las paradas de colectivo.'
  };

  // Recetas propias, por producto principal.
  var RECIPES = {
    770: [
      {
        title: 'Chipa casera', minutes: 60, servings: 20,
        ingredients: ['500 g de almidón de mandioca', '250 g de queso Paraguay rallado', '100 g de manteca o grasa', '3 huevos', '1 cucharadita de anís', 'Leche, la necesaria (aprox. 1/2 taza)', 'Sal a gusto'],
        steps: ['Batir la manteca con los huevos hasta integrar.', 'Agregar el queso, el anís y la sal, y mezclar.', 'Sumar el almidón de a poco y amasar, agregando leche hasta lograr una masa suave que no se pegue.', 'Formar rosquitas o bollitos y ubicarlos en una placa enmantecada.', 'Hornear a 200 °C unos 20 a 25 minutos, hasta que estén dorados.'],
        uses: [889]
      },
      {
        title: 'Mbeju', minutes: 25, servings: 4,
        ingredients: ['2 tazas de almidón de mandioca', '1 taza de queso Paraguay rallado', '2 cucharadas de manteca', '1/2 taza de leche', 'Sal a gusto'],
        steps: ['Mezclar el almidón con la manteca y la sal hasta formar un granulado.', 'Agregar el queso y humedecer con la leche de a poco, sin formar masa: debe quedar arenoso.', 'Calentar una sartén y volcar la mezcla, aplanando con una cuchara.', 'Cocinar a fuego medio unos 4 minutos por lado, hasta dorar.'],
        uses: [1035]
      }
    ],
    942: [{
      title: 'Arroz amarillo con cúrcuma', minutes: 30, servings: 4,
      ingredients: ['2 tazas de arroz', '4 tazas de caldo o agua', '1 cucharadita de cúrcuma en polvo', '1 cebolla picada', '2 cucharadas de aceite', 'Sal a gusto'],
      steps: ['Rehogar la cebolla en el aceite hasta que esté transparente.', 'Agregar el arroz y la cúrcuma y revolver un minuto.', 'Sumar el caldo caliente y la sal.', 'Cocinar tapado a fuego bajo unos 18 minutos, hasta que el arroz absorba el líquido.'],
      uses: [948]
    }],
    944: [{
      title: 'Infusión de jengibre con miel', minutes: 10, servings: 2,
      ingredients: ['2 tazas de agua', '1/2 cucharadita de jengibre en polvo', '2 cucharaditas de miel', 'Jugo de medio limón'],
      steps: ['Calentar el agua sin que llegue a hervir.', 'Agregar el jengibre y dejar reposar 5 minutos.', 'Endulzar con la miel y sumar el limón al servir.'],
      uses: [963]
    }],
    738: [{
      title: 'Pudín de chía con miel', minutes: 10, servings: 2,
      ingredients: ['4 cucharadas de chía', '1 taza de leche o bebida vegetal', '1 cucharada de miel', 'Fruta de estación para servir'],
      steps: ['Mezclar la chía con la leche y la miel.', 'Revolver otra vez a los 5 minutos para que no se formen grumos.', 'Llevar a la heladera al menos 4 horas o toda la noche.', 'Servir con fruta picada.'],
      uses: [963]
    }],
    2148: [{
      title: 'Spaghetti de remolacha con ajo, aceite y kuratu', minutes: 20, servings: 3,
      ingredients: ['1 paquete de spaghetti de remolacha (300 g)', '3 dientes de ajo en láminas', '4 cucharadas de aceite de oliva', '1 cucharadita de kuratu molido', 'Queso rallado a gusto', 'Sal a gusto'],
      steps: ['Hervir la pasta en abundante agua con sal según el tiempo del paquete.', 'Mientras tanto, dorar suavemente el ajo en el aceite, sin quemarlo.', 'Escurrir la pasta y saltearla en la sartén con el ajo y el kuratu.', 'Servir con queso rallado.'],
      uses: [948]
    }],
    1814: [{
      title: 'Spaghetti de espinaca con salsa de tomate casera', minutes: 35, servings: 3,
      ingredients: ['1 paquete de spaghetti de espinaca (300 g)', '4 tomates maduros', '1 cebolla', '1 diente de ajo', '1 cucharadita de pimiento dulce en polvo', 'Aceite y sal'],
      steps: ['Rehogar la cebolla y el ajo picados en un poco de aceite.', 'Agregar los tomates picados, el pimiento dulce y la sal; cocinar 15 minutos a fuego bajo.', 'Hervir la pasta según el tiempo del paquete y escurrir.', 'Servir la pasta con la salsa caliente.'],
      uses: [946]
    }],
    1810: [{
      title: 'Spaghetti de zanahoria salteado con verduras y jengibre', minutes: 25, servings: 3,
      ingredients: ['1 paquete de spaghetti de zanahoria (300 g)', '1 locote en tiras', '1 cebolla en pluma', '1 zucchini en bastones', '1/2 cucharadita de jengibre en polvo', 'Aceite y sal'],
      steps: ['Hervir la pasta según el tiempo del paquete y escurrir.', 'Saltear las verduras en una sartén bien caliente con un poco de aceite.', 'Agregar el jengibre y la sal, y luego la pasta.', 'Mezclar todo un minuto más y servir.'],
      uses: [944]
    }],
    1029: [{
      title: 'Guiso de poroto rojo', minutes: 90, servings: 6,
      ingredients: ['500 g de poroto rojo', '1 cebolla', '1 locote', '2 tomates', '1 zanahoria', '1 cucharadita de pimiento dulce en polvo', 'Aceite y sal'],
      steps: ['Dejar los porotos en remojo la noche anterior y escurrir.', 'Cocinarlos en agua nueva hasta que estén tiernos, unos 60 minutos.', 'Aparte, rehogar la cebolla, el locote, el tomate y la zanahoria picados.', 'Sumar el sofrito y el pimiento dulce a los porotos y cocinar 20 minutos más. Ajustar la sal.'],
      uses: [946]
    }],
    742: [{
      title: 'Ka’i ladrillo', minutes: 30, servings: 12,
      ingredients: ['2 tazas de maní tostado', '1 taza de miel de abeja o miel de caña', '1/2 taza de azúcar'],
      steps: ['Calentar la miel con el azúcar a fuego medio, revolviendo, hasta que tome punto de caramelo claro.', 'Agregar el maní y mezclar rápido.', 'Volcar sobre una superficie aceitada y aplanar con una espátula.', 'Cortar en cuadrados antes de que se enfríe del todo.'],
      uses: [963]
    }],
    901: [{
      title: 'Agua para tereré con cedrón', minutes: 10, servings: 6,
      ingredients: ['1 litro de agua fría', '1 puñado de cedrón Paraguay', 'Hielo', 'Opcional: hojas de ka’a he’ẽ para endulzar'],
      steps: ['Machacar levemente el cedrón en un mortero para que suelte su aroma.', 'Ponerlo en la jarra con el agua fría y el hielo.', 'Dejar reposar unos minutos antes de cebar el tereré.'],
      uses: [929]
    }],
    740: [{
      title: 'Mamón con queso Paraguay', minutes: 5, servings: 4,
      ingredients: ['4 porciones de dulce de mamón', '4 rodajas de queso Paraguay'],
      steps: ['Servir cada porción de dulce con su almíbar.', 'Acompañar con una rodaja de queso Paraguay.'],
      uses: []
    }]
  };

  function presentationOf(row) {
    return row[3];
  }

  /** Productos listos para el catálogo: activos, sin precio, con foto, descripción, historia y recetas. */
  function products(coopId) {
    return ROWS.map(function (r) {
      var id = r[0];
      var recipes = (RECIPES[id] || []).map(function (rc) {
        return {
          title: rc.title, minutes: rc.minutes, servings: rc.servings, ingredients: rc.ingredients.slice(), steps: rc.steps.slice(),
          uses: (rc.uses || []).map(function (u) { return 'ECO-' + u; })
        };
      });
      return {
        sku: 'ECO-' + id,
        name: r[1],
        coopId: coopId,
        origin: r[4] ? 'Marca: ' + r[4] : OWN_LINE.indexOf(id) !== -1 ? 'Línea Eco Agro Naturalmente' : '',
        categoryId: r[2],
        presentation: presentationOf(r),
        stockUnit: 'unidad',
        saleUnit: 'unidad',
        saleFactor: 1,
        conversions: [],
        status: 'activo',
        docRequired: false,
        docRef: '',
        description: r[5],
        story: STORIES[id] || '',
        recipes: recipes,
        claims: (CLAIMS[id] || []).slice(),
        photo: 'assets/productos/eco-' + id + '.jpg',
        video: null,
        source: 'Tienda Ecoagro, producto ' + id,
        pricing: { costoProveedor: null, costoLogistico: null, precioAlmacen: null, precioSugerido: null }
      };
    });
  }

  return { CATEGORIES: CATEGORIES, products: products, count: ROWS.length };
});
